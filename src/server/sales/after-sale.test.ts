import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { auditLog, lead, leadActivity, reservationTransfer, unit, unitSwap } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { sumCentimes } from "@/lib/money";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { updateUnitPriceSchema } from "@/server/inventory/schemas";
import { updateUnitPrice } from "@/server/inventory/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { createBankLoan, listSaleBankLoans, updateBankLoan } from "./bank-loans";
import { swapUnit, transferReservation } from "./changes";
import { createReservation } from "./reservations";
import { getSale } from "./sale-queries";
import {
  createBankLoanSchema,
  createReservationSchema,
  proposeWithdrawalSchema,
  swapUnitSchema,
  transferReservationSchema,
  updateBankLoanSchema,
} from "./schemas";
import {
  decideWithdrawal,
  listSaleWithdrawals,
  proposeWithdrawal,
  recordWithdrawalRefund,
} from "./withdrawals";

const today = todayInAlgiers();

async function newBuyer(ctx: TenantCtx, nin: string) {
  const phone = `0550 02 ${nin.slice(-4, -2)} ${nin.slice(-2)}`;
  const leadId = await newLead(ctx, phone);
  const { id } = await createBuyer(
    ctx,
    createBuyerSchema.parse({ lastName: "Ziani", firstName: "Sofiane", nin, phone, leadId }),
  );
  return { id, leadId };
}

async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  const cashier = await addMember(team.orgId, ["cashier"]);
  const buyer = await newBuyer(team.agentA, "109085198500300001");
  const { id: saleId } = await createReservation(
    team.agentA,
    createReservationSchema.parse({
      unitId: setup.unitIds[0],
      buyerIds: [buyer.id],
      paymentPlanId: setup.planId,
      discount: "",
      reservedOn: today,
      notary: "",
      reference: "",
      notes: "",
    }),
  );
  const pay = (amount: string, method = "cash") =>
    recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount,
        method,
        paidOn: today,
        payerName: "Sofiane Ziani",
        ...(method === "cheque" ? { reference: "1", bank: "BNA" } : {}),
      }),
    );
  return { team, ...setup, cashier, buyer, saleId, pay };
}

const unitStatus = async (ctx: TenantCtx, unitId: string) =>
  (
    await withTenant(ctx, (tx) =>
      tx.select({ s: unit.status }).from(unit).where(eq(unit.id, unitId)),
    )
  )[0]?.s;

describe("withdrawals", () => {
  it("are proposed by managers, approved by the gérant, and refunded once", async () => {
    const { team, cashier, unitIds, saleId, buyer, pay } = await scenario();
    await pay("2 000 000");
    const input = proposeWithdrawalSchema.parse({
      reservationId: saleId,
      retention: "10",
      reason: "Raisons familiales",
    });

    await expect(proposeWithdrawal(team.agentA, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const proposed = await proposeWithdrawal(team.manager, input);
    expect(proposed).toMatchObject({
      paid: 200_000_000n,
      retention: 20_000_000n,
      refund: 180_000_000n,
    });
    await expect(proposeWithdrawal(team.manager, input)).rejects.toMatchObject({
      messageKey: "sales.withdrawal.errors.alreadyOpen",
    });
    await expect(
      decideWithdrawal(team.manager, { withdrawalId: proposed.id, approve: true, note: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A payment received meanwhile counts at the approval.
    await pay("1 000 000");
    await decideWithdrawal(team.owner, { withdrawalId: proposed.id, approve: true, note: null });
    const [decided] = await listSaleWithdrawals(team.manager, saleId);
    expect(decided).toMatchObject({
      status: "approved",
      paid: 300_000_000n,
      retention: 30_000_000n,
      refund: 270_000_000n,
    });
    expect((await getSale(team.manager, saleId))?.status).toBe("withdrawn");
    expect(await unitStatus(team.owner, unitIds[0])).toBe("available");
    const activities = await withTenant(team.owner, (tx) =>
      tx
        .select({ type: leadActivity.type })
        .from(leadActivity)
        .where(and(eq(leadActivity.leadId, buyer.leadId), eq(leadActivity.type, "withdrawn"))),
    );
    expect(activities).toHaveLength(1);
    await expect(pay("1 000")).rejects.toMatchObject({
      messageKey: "payments.errors.saleClosed",
    });

    const refund = {
      withdrawalId: proposed.id,
      refundedOn: today,
      method: "cheque",
      reference: "77",
    } as const;
    await expect(recordWithdrawalRefund(team.agentA, refund)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await recordWithdrawalRefund(cashier, refund);
    await expect(recordWithdrawalRefund(cashier, refund)).rejects.toMatchObject({
      messageKey: "sales.withdrawal.errors.noRefundDue",
    });
    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, saleId), sql`${auditLog.action} like 'withdrawal.%'`)),
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      "withdrawal.approve",
      "withdrawal.propose",
      "withdrawal.refund",
    ]);

    // The unit is on sale again.
    const other = await newBuyer(team.agentB, "109085198500300002");
    const again = await createReservation(
      team.agentB,
      createReservationSchema.parse({
        unitId: unitIds[0],
        buyerIds: [other.id],
        paymentPlanId: (await getSale(team.manager, saleId))?.paymentPlanId ?? "",
        discount: "",
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    expect(again.number).toMatch(/000002$/);
  });

  it("can be rejected with a note, then proposed again", async () => {
    const { team, saleId } = await scenario();
    const input = proposeWithdrawalSchema.parse({
      reservationId: saleId,
      retention: "0",
      reason: "Erreur",
    });
    const { id } = await proposeWithdrawal(team.manager, input);
    await expect(
      decideWithdrawal(team.owner, { withdrawalId: id, approve: false, note: null }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await decideWithdrawal(team.owner, { withdrawalId: id, approve: false, note: "Client resté" });
    expect((await getSale(team.manager, saleId))?.status).toBe("reserved");
    await proposeWithdrawal(team.manager, input);
    expect((await listSaleWithdrawals(team.manager, saleId)).map((w) => w.status)).toEqual([
      "proposed",
      "rejected",
    ]);
  });
});

describe("transfers and unit swaps", () => {
  it("hand the reservation over to new buyers, with its payments", async () => {
    const { team, saleId, buyer, pay } = await scenario();
    await pay("500 000");
    const next = await newBuyer(team.manager, "109085198500300003");
    const input = transferReservationSchema.parse({
      reservationId: saleId,
      buyerIds: [next.id, buyer.id],
      transferredOn: today,
      notes: "Cession au frère",
    });

    await expect(transferReservation(team.agentA, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await transferReservation(team.manager, input);
    await expect(transferReservation(team.manager, input)).rejects.toMatchObject({
      messageKey: "sales.transfer.errors.sameBuyers",
    });
    const sale = await getSale(team.manager, saleId);
    expect(sale?.buyers.map((b) => b.id)).toEqual([next.id, buyer.id]);
    expect(sale?.statement.paid).toBe(50_000_000n);
    const [history] = await withTenant(team.manager, (tx) =>
      tx.select().from(reservationTransfer).where(eq(reservationTransfer.reservationId, saleId)),
    );
    expect(history).toMatchObject({ fromBuyerIds: [buyer.id], toBuyerIds: [next.id, buyer.id] });
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job
          where name = 'pdf.document' and data->>'id' = ${saleId}`,
    );
    expect(rows[0]?.n).toBe(2);
  });

  it("move the sale to another unit at its price, keeping shares and payments", async () => {
    const { team, unitIds, saleId, pay } = await scenario();
    await pay("2 602 000");
    await updateUnitPrice(
      team.manager,
      updateUnitPriceSchema.parse({ unitId: unitIds[1], price: "14 000 000", reason: "Vue mer" }),
    );
    await updateUnitPrice(
      team.manager,
      updateUnitPriceSchema.parse({ unitId: unitIds[2], price: "1 000 000", reason: "Test" }),
    );
    const swap = (unitId: string) =>
      swapUnit(
        team.manager,
        swapUnitSchema.parse({
          reservationId: saleId,
          unitId,
          discount: "",
          swappedOn: today,
          reason: "Étage plus haut",
        }),
      );

    await expect(swap(unitIds[0])).rejects.toMatchObject({
      messageKey: "sales.swap.errors.sameUnit",
    });
    await expect(swap(unitIds[2])).rejects.toMatchObject({
      messageKey: "sales.swap.errors.paidAbovePrice",
    });
    expect(await swap(unitIds[1])).toEqual({ price: 1_400_000_000n });

    const sale = await getSale(team.manager, saleId);
    expect(sale).toMatchObject({
      unitId: unitIds[1],
      price: 1_400_000_000n,
      listPrice: 1_400_000_000n,
    });
    expect(sale?.installments.map((i) => i.amount)).toEqual([
      280_000_000n,
      420_000_000n,
      700_000_000n,
    ]);
    expect(sumCentimes(sale?.installments.map((i) => i.amount) ?? [])).toBe(1_400_000_000n);
    expect(sale?.statement).toMatchObject({ paid: 260_200_000n, due: 19_800_000n });
    expect(await unitStatus(team.owner, unitIds[0])).toBe("available");
    expect(await unitStatus(team.owner, unitIds[1])).toBe("reserved");
    const [history] = await withTenant(team.manager, (tx) =>
      tx.select().from(unitSwap).where(eq(unitSwap.reservationId, saleId)),
    );
    expect(history).toMatchObject({ fromPrice: 1_301_000_000n, toPrice: 1_400_000_000n });
    // The lead keeps its stage: the swap is not a new sale.
    const [leadRow] = await withTenant(team.owner, (tx) =>
      tx
        .select({ stage: lead.stage })
        .from(lead)
        .where(eq(lead.id, sale?.leadId ?? "")),
    );
    expect(leadRow?.stage).toBe("won");
  });
});

describe("bank loans", () => {
  it("follow one loan per sale and count what the bank disbursed", async () => {
    const { team, saleId, pay } = await scenario();
    const input = createBankLoanSchema.parse({
      reservationId: saleId,
      bank: "CNEP-Banque",
      requested: "8 000 000",
      approved: "",
      status: "submitted",
      submittedOn: today,
      decidedOn: "",
      reference: "DOS-2026-14",
      notes: "",
    });

    await expect(createBankLoan(team.agentA, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id } = await createBankLoan(team.manager, input);
    await expect(createBankLoan(team.manager, input)).rejects.toMatchObject({
      messageKey: "sales.loan.errors.alreadyOpen",
    });
    const update = (approved: string) =>
      updateBankLoan(
        team.manager,
        updateBankLoanSchema.parse({
          bankLoanId: id,
          bank: "CNEP-Banque",
          requested: "8 000 000",
          approved,
          status: "approved",
          submittedOn: today,
          decidedOn: today,
          reference: "DOS-2026-14",
          notes: "Accord de principe",
        }),
      );
    await expect(update("")).rejects.toMatchObject({ code: "VALIDATION" });
    await update("7 500 000");
    await pay("3 000 000", "bank_loan");

    const { loans, disbursed } = await listSaleBankLoans(team.agentA, saleId);
    expect(loans).toEqual([
      expect.objectContaining({ id, status: "approved", approved: 750_000_000n }),
    ]);
    expect(disbursed).toBe(300_000_000n);
    expect(await listSaleBankLoans(team.agentB, saleId).catch((e: unknown) => e)).toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
