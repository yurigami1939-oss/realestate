import { afterAll, describe, expect, it } from "vitest";

import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { suggestMatches } from "@/lib/reconciliation";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { runImport } from "@/server/imports/service";
import { cancelPaymentSchema, recordPaymentSchema } from "@/server/payments/schemas";
import { cancelPayment, recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { createChequeDeposit } from "./deposits";
import {
  applySuggestions,
  bookStatementLine,
  deleteStatement,
  dismissStatementLine,
  getReconciliation,
  matchStatementLine,
  unmatchStatementLine,
} from "./reconciliation";
import { createAccountSchema, createChequeDepositSchema } from "./schemas";
import { createAccount } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();
const typed = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const csv = (rows: string[][]) =>
  Buffer.from(
    ["Date;Libellé;Référence;Débit;Crédit", ...rows.map((r) => r.join(";"))].join("\r\n"),
  );

describe("bank reconciliation suggestions", () => {
  it("picks the closest entry of the same amount, a slip for a credit, nothing when unsure", () => {
    const suggestions = suggestMatches(
      [
        { id: "a", bookedOn: "2026-10-05", amount: 15_000_000n },
        { id: "b", bookedOn: "2026-10-06", amount: 50_000_000n },
        { id: "c", bookedOn: "2026-10-06", amount: -120_000n },
        { id: "d", bookedOn: "2026-10-06", amount: 900n },
      ],
      [
        { key: "sale:1", on: "2026-10-02", amount: 15_000_000n },
        { key: "sale:2", on: "2026-10-04", amount: 15_000_000n },
        { key: "sale:3", on: "2026-10-03", amount: 30_000_000n },
        { key: "sale:4", on: "2026-10-03", amount: 20_000_000n },
        { key: "movement:5", on: "2026-10-05", amount: -120_000n },
        { key: "movement:6", on: "2026-10-07", amount: -120_000n },
        { key: "movement:7", on: "2026-09-01", amount: 900n },
      ],
      [
        {
          number: "BRC-1",
          depositedOn: "2026-10-03",
          keys: ["sale:3", "sale:4"],
          amount: 50_000_000n,
        },
      ],
    );
    expect(suggestions.get("a")).toEqual({ keys: ["sale:2"], slip: null });
    expect(suggestions.get("b")).toEqual({ keys: ["sale:3", "sale:4"], slip: "BRC-1" });
    // Two fees as close: no guess. An entry too far away: none either.
    expect(suggestions.has("c")).toBe(false);
    expect(suggestions.has("d")).toBe(false);
  });
});

describe("bank reconciliation", () => {
  it("imports a statement, matches its lines, books a fee and sets a line aside", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({ lastName: "Bensalem", firstName: "Karim", phone: "0550 12 34 56" }),
    );
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: addDays(today, -5),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    const { id: bankId } = await createAccount(
      accountant,
      createAccountSchema.parse({
        kind: "bank",
        name: "BNA compte courant",
        bankName: "BNA",
        accountNumber: "",
        isDefault: true,
        notes: "",
        openingBalance: "0",
        openingOn: addDays(today, -10),
      }),
    );
    const pay = (amount: string, method: "cheque" | "bank_transfer") =>
      recordPayment(
        cashier,
        recordPaymentSchema.parse({
          reservationId: saleId,
          amount,
          method,
          paidOn: today,
          reference: method === "cheque" ? "0042" : "VIR-77",
          bank: method === "cheque" ? "CPA" : "",
          payerName: "Bensalem Karim",
          accountId: bankId,
        }),
      );
    const first = await pay("300 000", "cheque");
    const second = await pay("200 000", "cheque");
    const transfer = await pay("150 000", "bank_transfer");
    const slip = await createChequeDeposit(
      cashier,
      createChequeDepositSchema.parse({
        accountId: bankId,
        depositedOn: today,
        cheques: [first, second].map((p) => ({ source: "sale", paymentId: p.paymentId })),
      }),
    );

    // A line with both a debit and a credit blocks the file: nothing is written.
    const bad = await runImport(
      accountant,
      "bank_statement",
      csv([[typed(today), "OPERATION", "", "10,00", "10,00"]]),
      { accountId: bankId, commit: true },
    );
    expect(bad.committed).toBe(false);
    expect(bad.issues.map((i) => i.messageKey)).toEqual(["imports.errors.debitOrCredit"]);

    const statement = csv([
      [typed(today), "REMISE CHEQUES", "BRC", "", "500 000,00"],
      [typed(today), "VIR RECU BENSALEM", "VIR-77", "", "150000"],
      [typed(today), "FRAIS TENUE DE COMPTE", "", "1 200,00", ""],
      [typed(today), "VIR RECU INCONNU", "", "", "80 000,00"],
      [typed(addDays(today, -20)), "ANCIENNE OPERATION", "", "", "1 000,00"],
    ]);
    await expect(
      runImport(cashier, "bank_statement", statement, { accountId: bankId, commit: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const imported = await runImport(accountant, "bank_statement", statement, {
      accountId: bankId,
      commit: true,
    });
    expect(imported).toMatchObject({ committed: true, counts: { statementLines: 4 } });
    expect(imported.warnings.map((w) => w.messageKey)).toEqual(["imports.warnings.beforeOpening"]);
    // The same statement again: every line is already there.
    const again = await runImport(accountant, "bank_statement", statement, {
      accountId: bankId,
      commit: true,
    });
    expect(again).toMatchObject({ committed: false, counts: { statementLines: 0 } });

    const period = { from: today, to: today };
    const view = async () => {
      const data = await getReconciliation(cashier, bankId, period);
      if (!data) throw new Error("no reconciliation");
      return data;
    };
    const lineOf = async (label: string) => {
      const line = (await view()).lines.find((l) => l.label === label);
      if (!line) throw new Error(`no line ${label}`);
      return line;
    };
    const initial = await view();
    expect(initial.totals).toMatchObject({ lines: 4, open: 4, suggested: 2 });
    expect((await lineOf("REMISE CHEQUES")).suggestion?.slip).toBe(slip.number);
    expect((await lineOf("VIR RECU BENSALEM")).suggestion?.entries.map((e) => e.key)).toEqual([
      `sale:${transfer.paymentId}`,
    ]);

    await expect(applySuggestions(cashier, { accountId: bankId, ...period })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    expect(await applySuggestions(accountant, { accountId: bankId, ...period })).toEqual({
      matched: 2,
    });

    // The bank's fee becomes a movement, matched at once; never as an income.
    const fee = await lineOf("FRAIS TENUE DE COMPTE");
    await expect(
      bookStatementLine(accountant, {
        lineId: fee.id,
        kind: "income",
        label: "Frais",
        category: null,
      }),
    ).rejects.toMatchObject({ messageKey: "treasury.errors.bookDirection" });
    await bookStatementLine(accountant, {
      lineId: fee.id,
      kind: "bank_fee",
      label: "Frais de tenue de compte",
      category: null,
    });
    expect((await lineOf("FRAIS TENUE DE COMPTE")).state).toBe("matched");

    const unknown = await lineOf("VIR RECU INCONNU");
    await dismissStatementLine(accountant, { lineId: unknown.id, reason: "Virement à identifier" });
    expect((await lineOf("VIR RECU INCONNU")).state).toBe("dismissed");
    await expect(
      deleteStatement(accountant, { statementId: initial.statements[0]?.id ?? "" }),
    ).rejects.toMatchObject({ messageKey: "treasury.errors.statementUsed" });

    // Undone, then matched by hand: the total must be the line's.
    const received = await lineOf("VIR RECU BENSALEM");
    await unmatchStatementLine(accountant, { lineId: received.id });
    await expect(
      matchStatementLine(accountant, {
        lineId: received.id,
        entryKeys: [`sale:${first.paymentId}`],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      matchStatementLine(accountant, {
        lineId: received.id,
        entryKeys: [`movement:${received.id}`],
      }),
    ).rejects.toMatchObject({ messageKey: "treasury.errors.entryUnknown" });
    await matchStatementLine(accountant, {
      lineId: received.id,
      entryKeys: [`sale:${transfer.paymentId}`],
    });

    // A payment cancelled leaves the ledger: its line is to match again.
    await cancelPayment(
      accountant,
      cancelPaymentSchema.parse({ paymentId: transfer.paymentId, reason: "Virement rejeté" }),
    );
    const final = await view();
    expect(final.totals).toMatchObject({ lines: 4, matched: 2, dismissed: 1, open: 1 });
    expect(final.unmatchedEntries).toEqual([]);
  });
});
