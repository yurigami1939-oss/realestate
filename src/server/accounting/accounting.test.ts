import { afterAll, describe, expect, it } from "vitest";

import { stopEnqueue } from "@/jobs/enqueue";
import { counterpartKey } from "@/lib/accounting";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";
import { createAccountSchema, recordMovementSchema } from "@/server/treasury/schemas";
import { createAccount, recordMovement } from "@/server/treasury/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { accountingCodesSchema } from "./schemas";
import { getAccountingEntries, getAccountingSetup, saveAccountingCodes } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("accounting export", () => {
  it("maps each ledger source to its counterpart", () => {
    expect(counterpartKey("sale", { direction: "in" })).toBe("clients");
    expect(counterpartKey("rent", { direction: "in", deposit: true })).toBe("deposits");
    expect(counterpartKey("works", { direction: "out" })).toBe("contractors");
    expect(counterpartKey("adjustment", { direction: "out" })).toBe("cashShort");
    expect(counterpartKey("expense", { direction: "out" })).toBe("expenses");
  });

  it("writes every flow of every account as two balanced lines", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const account = (kind: "cash" | "bank", name: string) =>
      createAccount(
        accountant,
        createAccountSchema.parse({
          kind,
          name,
          bankName: kind === "bank" ? "BNA" : "",
          accountNumber: "",
          isDefault: true,
          notes: "",
          openingBalance: "100 000",
          openingOn: addDays(today, -30),
        }),
      );
    const { id: cashId } = await account("cash", "Caisse");
    const { id: bankId } = await account("bank", "BNA");
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
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    const { receiptNumber } = await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "50 000",
        method: "cash",
        paidOn: today,
        payerName: "Bensalem Karim",
      }),
    );
    const move = (input: Record<string, string>) =>
      recordMovement(
        accountant,
        recordMovementSchema.parse({ toAccountId: "", category: "", reference: "", ...input }),
      );
    await move({
      kind: "bank_fee",
      accountId: bankId,
      amount: "1 200",
      movedOn: today,
      label: "Frais de tenue de compte",
    });
    await move({
      kind: "transfer",
      accountId: cashId,
      toAccountId: bankId,
      amount: "20 000",
      movedOn: today,
      label: "Versement en banque",
    });

    await expect(getAccountingEntries(cashier, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await saveAccountingCodes(
      accountant,
      accountingCodesSchema.parse({
        codes: { clients: "419100" },
        accounts: [{ accountId: bankId, code: "512100", journal: "BQ1" }],
      }),
    );
    const chart = await getAccountingSetup(accountant);
    expect(chart.codes).toMatchObject({ clients: "419100", bankFees: "627000" });
    expect(chart.accounts.map((a) => [a.name, a.code, a.journal])).toEqual([
      ["Caisse", "530000", "CA"],
      ["BNA", "512100", "BQ1"],
    ]);

    const entries = await getAccountingEntries(accountant, { from: today, to: today });
    expect(entries.debit).toBe(entries.credit);
    const pair = (piece: string | RegExp) =>
      entries.lines
        .filter((l) => (typeof piece === "string" ? l.piece === piece : piece.test(l.label)))
        .map((l) => [l.journal, l.account, l.debit, l.credit]);
    expect(pair(receiptNumber)).toEqual([
      ["CA", "530000", 5_000_000n, 0n],
      ["CA", "419100", 0n, 5_000_000n],
    ]);
    expect(pair(/^Frais de tenue de compte/)).toEqual([
      ["BQ1", "627000", 120_000n, 0n],
      ["BQ1", "512100", 0n, 120_000n],
    ]);
    // A transfer passes through the internal transfers account, once in each journal.
    expect(pair(/^Versement en banque/)).toEqual([
      ["BQ1", "512100", 2_000_000n, 0n],
      ["BQ1", "581000", 0n, 2_000_000n],
      ["CA", "581000", 2_000_000n, 0n],
      ["CA", "530000", 0n, 2_000_000n],
    ]);
  });
});
