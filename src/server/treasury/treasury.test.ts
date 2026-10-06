import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, payment, treasuryMovement } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { cancelPaymentSchema, recordPaymentSchema } from "@/server/payments/schemas";
import { cancelPayment, recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import {
  clearChequeDeposit,
  createChequeDeposit,
  listChequeDeposits,
  listPendingCheques,
} from "./deposits";
import { renderAndStoreChequeDeposit } from "./documents";
import { getAccountLedger, listAccountChoices, listAccounts } from "./queries";
import {
  cancelMovementSchema,
  cashCountSchema,
  clearChequeDepositSchema,
  closeAccountSchema,
  createAccountSchema,
  createChequeDepositSchema,
  recordMovementSchema,
} from "./schemas";
import {
  cancelMovement,
  closeAccount,
  createAccount,
  recordCashCount,
  recordMovement,
} from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

/** A reservation signed today (13 010 000 DA) with a cashier, an accountant and two accounts. */
async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const { id: buyerId } = await createBuyer(
    team.manager,
    createBuyerSchema.parse({
      lastName: "Bensalem",
      firstName: "Karim",
      phone: "0550 12 34 56",
      leadId: "",
    }),
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
  const cashier = await addMember(team.orgId, ["cashier"]);
  const accountant = await addMember(team.orgId, ["accountant"]);
  const account = (
    kind: "cash" | "bank" | "ccp",
    name: string,
    opening: string,
    isDefault = true,
  ) =>
    createAccount(
      accountant,
      createAccountSchema.parse({
        kind,
        name,
        bankName: kind === "cash" ? "" : "BNA",
        accountNumber: kind === "cash" ? "" : "00100123012345678901",
        isDefault,
        notes: "",
        openingBalance: opening,
        openingOn: addDays(today, -10),
      }),
    );
  const { id: cashId } = await account("cash", "Caisse siège", "100 000");
  const { id: bankId } = await account("bank", "BNA compte courant", "0");
  const pay = (
    ctx: TenantCtx,
    amount: string,
    method: "cash" | "cheque" | "bank_transfer" | "ccp",
    accountId = "",
  ) =>
    recordPayment(
      ctx,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount,
        method,
        paidOn: today,
        reference: method === "cheque" ? "0042" : "",
        bank: method === "cheque" ? "CPA" : "",
        payerName: "Bensalem Karim",
        accountId,
      }),
    );
  return { team, saleId, cashier, accountant, cashId, bankId, pay };
}

const accountOf = async (ctx: TenantCtx, paymentId: string) =>
  (
    await withTenant(ctx, (tx) =>
      tx.select({ accountId: payment.accountId }).from(payment).where(eq(payment.id, paymentId)),
    )
  )[0]?.accountId;

describe("treasury", () => {
  it("lands each collection on an account and derives the balances", async () => {
    const { team, cashier, accountant, cashId, bankId, pay } = await scenario();
    await expect(
      createAccount(
        cashier,
        createAccountSchema.parse({
          kind: "cash",
          name: "Caisse 2",
          bankName: "",
          accountNumber: "",
          isDefault: false,
          notes: "",
          openingBalance: "0",
          openingOn: today,
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAccounts(team.agentA)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const cash = await pay(cashier, "50 000", "cash");
    const transfer = await pay(cashier, "1 000 000", "bank_transfer");
    // No CCP account: a CCP payment lands on the default bank account.
    const ccp = await pay(cashier, "20 000", "ccp");
    const cheque = await pay(cashier, "300 000", "cheque", bankId);
    await expect(pay(cashier, "10 000", "cheque", cashId)).rejects.toMatchObject({
      messageKey: "treasury.errors.accountKind",
    });
    expect(await accountOf(team.owner, cash.paymentId)).toBe(cashId);
    expect(await accountOf(team.owner, transfer.paymentId)).toBe(bankId);
    expect(await accountOf(team.owner, ccp.paymentId)).toBe(bankId);
    expect(await accountOf(team.owner, cheque.paymentId)).toBe(bankId);

    const balances = async () =>
      Object.fromEntries(
        (await listAccounts(cashier)).map((a) => [
          a.name,
          { balance: a.balance, inOn: a.inOn, pendingCheques: a.pendingCheques },
        ]),
      );
    expect(await balances()).toEqual({
      "Caisse siège": { balance: 15_000_000n, inOn: 5_000_000n, pendingCheques: 0n },
      "BNA compte courant": {
        balance: 132_000_000n,
        inOn: 132_000_000n,
        pendingCheques: 30_000_000n,
      },
    });
    // A cancelled payment leaves its account.
    await cancelPayment(
      accountant,
      cancelPaymentSchema.parse({ paymentId: cash.paymentId, reason: "Erreur de saisie" }),
    );
    expect((await balances())["Caisse siège"]?.balance).toBe(10_000_000n);
    expect((await listAccountChoices(cashier)).map((c) => c.name)).toEqual([
      "Caisse siège",
      "BNA compte courant",
    ]);
  });

  it("records movements, transfers and cash counts in the ledger, then closes an account", async () => {
    const { team, cashier, accountant, cashId, bankId, pay } = await scenario();
    await pay(cashier, "50 000", "cash");
    const movement = (input: Record<string, string>) =>
      recordMovement(
        accountant,
        recordMovementSchema.parse({
          accountId: cashId,
          toAccountId: "",
          movedOn: today,
          category: "",
          reference: "",
          ...input,
        }),
      );
    await expect(
      recordMovement(
        cashier,
        recordMovementSchema.parse({
          kind: "expense",
          accountId: cashId,
          amount: "1 000",
          movedOn: today,
          label: "Fournitures",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await movement({ kind: "expense", amount: "20 000", label: "Fournitures de bureau" });
    const { id: transferId } = await movement({
      kind: "transfer",
      toAccountId: bankId,
      amount: "100 000",
      label: "Versement des espèces en banque",
      reference: "BV 0012",
    });
    expect(
      recordMovementSchema.safeParse({
        kind: "transfer",
        accountId: cashId,
        toAccountId: cashId,
        amount: "1",
        movedOn: today,
        label: "x",
      }).error?.issues[0]?.message,
    ).toBe("treasury.errors.sameAccount");

    let ledger = await getAccountLedger(accountant, cashId, {});
    expect(ledger?.before).toBe(10_000_000n);
    expect(ledger?.lines.map((l) => [l.source, l.amountIn, l.amountOut, l.balance])).toEqual([
      ["sale", 5_000_000n, 0n, 15_000_000n],
      ["expense", 0n, 2_000_000n, 13_000_000n],
      ["transfer", 0n, 10_000_000n, 3_000_000n],
    ]);
    const bank = await getAccountLedger(accountant, bankId, {});
    expect(bank?.lines.map((l) => [l.source, l.amountIn])).toEqual([["transfer", 10_000_000n]]);

    // Cancelling a transfer cancels both sides.
    await cancelMovement(
      accountant,
      cancelMovementSchema.parse({ movementId: transferId, reason: "Versement refusé" }),
    );
    ledger = await getAccountLedger(accountant, cashId, {});
    expect(ledger?.closing).toBe(13_000_000n);
    expect((await getAccountLedger(accountant, bankId, {}))?.lines).toEqual([]);

    // Cash count: 500 DA missing, explained, booked as an adjustment.
    const count = (counted: string, note: string) =>
      recordCashCount(
        cashier,
        cashCountSchema.parse({ accountId: cashId, countedOn: today, counted, note }),
      );
    await expect(count("129 500", "")).rejects.toMatchObject({
      messageKey: "treasury.errors.differenceNote",
    });
    const counted = await count("129 500", "Monnaie rendue en trop");
    expect(counted).toMatchObject({ expected: 13_000_000n, difference: -50_000n });
    ledger = await getAccountLedger(accountant, cashId, {});
    expect(ledger?.closing).toBe(12_950_000n);
    expect(ledger?.counts[0]).toMatchObject({ counted: 12_950_000n, difference: -50_000n });
    const adjustment = ledger?.lines.find((l) => l.source === "adjustment");
    expect(adjustment).toMatchObject({ amountOut: 50_000n, movementId: null });
    await expect(count("10", "Banque")).resolves.toBeDefined();
    await expect(
      recordCashCount(
        cashier,
        cashCountSchema.parse({ accountId: bankId, countedOn: today, counted: "0", note: "" }),
      ),
    ).rejects.toMatchObject({ messageKey: "treasury.errors.notCash" });

    // An account closes only once empty; a closed account takes no money.
    await expect(
      closeAccount(accountant, closeAccountSchema.parse({ accountId: cashId, closedOn: today })),
    ).rejects.toMatchObject({ messageKey: "treasury.errors.balanceNotNil" });
    await closeAccount(
      accountant,
      closeAccountSchema.parse({ accountId: bankId, closedOn: today }),
    );
    await expect(pay(cashier, "1 000", "bank_transfer", bankId)).rejects.toMatchObject({
      messageKey: "treasury.errors.accountClosed",
    });
    // Without a default bank account, a transfer lands on no account.
    const loose = await pay(cashier, "1 000", "bank_transfer");
    expect(await accountOf(team.owner, loose.paymentId)).toBeNull();

    const actions = await withTenant(team.owner, (tx) =>
      tx.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, cashId)),
    );
    expect(actions.map((a) => a.action).sort()).toEqual([
      "cash_count.create",
      "cash_count.create",
      "treasury_account.create",
      "treasury_movement.cancel",
      "treasury_movement.create",
      "treasury_movement.create",
    ]);
    // Movements are kept: cancelled, never deleted.
    await expect(
      withTenant(team.owner, (tx) =>
        tx.delete(treasuryMovement).where(eq(treasuryMovement.accountId, cashId)),
      ),
    ).rejects.toThrow();
  });
  it("hands cheques to the bank on a numbered slip, then clears them together", async () => {
    const { team, cashier, accountant, cashId, bankId, pay } = await scenario();
    const first = await pay(cashier, "300 000", "cheque", bankId);
    const second = await pay(cashier, "200 000", "cheque", bankId);
    await pay(cashier, "50 000", "cash");
    const pending = await listPendingCheques(cashier, bankId);
    expect(pending.map((c) => [c.paymentId, c.amount])).toEqual([
      [first.paymentId, 30_000_000n],
      [second.paymentId, 20_000_000n],
    ]);
    const slip = (accountId: string, ids: string[]) =>
      createChequeDepositSchema.parse({
        accountId,
        depositedOn: today,
        cheques: ids.map((paymentId) => ({ source: "sale", paymentId })),
      });
    await expect(
      createChequeDeposit(team.agentA, slip(bankId, [first.paymentId])),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createChequeDeposit(cashier, slip(cashId, [first.paymentId])),
    ).rejects.toMatchObject({ messageKey: "treasury.errors.depositOnCash" });
    const { id, number, total } = await createChequeDeposit(
      cashier,
      slip(bankId, [first.paymentId, second.paymentId]),
    );
    expect(number).toMatch(/^BRC-\d{4}-000001$/);
    expect(total).toBe(50_000_000n);
    expect(await listPendingCheques(cashier, bankId)).toEqual([]);
    expect(await renderAndStoreChequeDeposit(team.orgId, id)).toBe("stored");
    expect(await renderAndStoreChequeDeposit(team.orgId, id)).toBe("skipped");
    // A cheque goes on one slip only.
    await expect(
      createChequeDeposit(cashier, slip(bankId, [first.paymentId])),
    ).rejects.toMatchObject({ messageKey: "treasury.errors.chequeNotPending" });

    // The second cheque bounced: cancelled first, the slip's other cheque is cleared.
    await cancelPayment(
      accountant,
      cancelPaymentSchema.parse({ paymentId: second.paymentId, reason: "Chèque impayé" }),
    );
    await expect(
      clearChequeDeposit(
        cashier,
        clearChequeDepositSchema.parse({ depositId: id, clearedOn: addDays(today, -1) }),
      ),
    ).rejects.toMatchObject({ messageKey: "treasury.errors.clearedBeforeDeposit" });
    await clearChequeDeposit(
      cashier,
      clearChequeDepositSchema.parse({ depositId: id, clearedOn: today }),
    );
    const [deposit] = await listChequeDeposits(accountant, bankId);
    expect(deposit).toMatchObject({ number, count: 2, clearedOn: today });
    const bank = (await listAccounts(cashier)).find((a) => a.id === bankId);
    expect(bank?.pendingCheques).toBe(0n);
    expect(bank?.balance).toBe(30_000_000n);
  });
});
