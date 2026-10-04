import "server-only";

import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import { chargePayment, residenceUnit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { loadResidence } from "@/server/residences/service";

import { chargeStatement, liveCalls, paidByUnit } from "./accounts";
import type {
  cancelChargePaymentSchema,
  clearChargeChequeSchema,
  recordChargePaymentSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/**
 * Records charges paid for a unit and issues its receipt RCH-… in the same transaction
 * (CLAUDE.md §7). Oldest due calls first; what exceeds the calls issued so far stays as a credit
 * for the next ones (CLAUDE.md §12). The receipt keeps what the payment settled; its PDF is
 * rendered by the worker. Audited.
 */
export async function recordChargePayment(
  ctx: TenantCtx,
  input: In<typeof recordChargePaymentSchema>,
) {
  assertCan(ctx, "payment:create");
  const today = todayInAlgiers();
  if (input.paidOn > today) throw invalid("paidOn", "charges.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    const home = await loadResidence(tx, input.residenceId);
    // The unit's row lock serializes its payments.
    const [member] = await tx
      .select({ unitId: residenceUnit.unitId })
      .from(residenceUnit)
      .where(and(eq(residenceUnit.residenceId, home.id), eq(residenceUnit.unitId, input.unitId)))
      .for("update");
    if (!member) throw invalid("unitId", "residences.errors.unitNotInResidence");

    const calls = await liveCalls(tx, home.id, [input.unitId]);
    const paidBefore = (await paidByUnit(tx, home.id, [input.unitId])).get(input.unitId) ?? 0n;
    const before = chargeStatement(calls, paidBefore, today);
    const after = chargeStatement(calls, paidBefore + input.amount, today);
    const allocation = after.lines.flatMap((line) => {
      const settled = line.paid - (before.lines.find((l) => l.id === line.id)?.paid ?? 0n);
      return settled > 0n ? [{ number: line.number, amount: settled.toString() }] : [];
    });

    const { number } = await nextDocumentNumber(tx, ctx, "charge_receipt");
    const [row] = await tx
      .insert(chargePayment)
      .values({
        organizationId: ctx.orgId,
        residenceId: home.id,
        unitId: input.unitId,
        amount: input.amount,
        method: input.method,
        paidOn: input.paidOn,
        reference: input.reference,
        bank: input.bank,
        payerName: input.payerName,
        notes: input.notes,
        receiptNumber: number,
        allocation,
        recordedBy: ctx.userId,
      })
      .returning({ id: chargePayment.id });
    if (!row) throw new Error("recordChargePayment: no row returned");

    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_payment.create",
      entityType: "charge_payment",
      entityId: row.id,
      after: {
        residence: home.name,
        receipt: number,
        amount: input.amount,
        method: input.method,
        paidOn: input.paidOn,
        reference: input.reference,
        allocation,
      },
    });
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "charge_receipt", id: row.id },
      { singletonKey: `charge_receipt:${row.id}` },
    );
    return { paymentId: row.id, receiptNumber: number, credit: after.credit - before.credit };
  });
}

/**
 * Cancels a charge payment and its receipt with a reason (accountants; e.g. a bounced cheque).
 * Never deleted; the calls it settled are due again (derived statement). Audited.
 */
export async function cancelChargePayment(
  ctx: TenantCtx,
  input: In<typeof cancelChargePaymentSchema>,
) {
  assertCan(ctx, "payment:cancel");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({
        status: chargePayment.status,
        amount: chargePayment.amount,
        receiptNumber: chargePayment.receiptNumber,
      })
      .from(chargePayment)
      .where(eq(chargePayment.id, input.paymentId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    if (current.status === "cancelled") {
      throw new AppError("CONFLICT", "payments.errors.alreadyCancelled");
    }
    await tx
      .update(chargePayment)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: ctx.userId,
        cancellationReason: input.reason,
      })
      .where(eq(chargePayment.id, input.paymentId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_payment.cancel",
      entityType: "charge_payment",
      entityId: input.paymentId,
      before: { status: "valid", amount: current.amount, receipt: current.receiptNumber },
      after: { status: "cancelled" },
      reason: input.reason,
    });
  });
}

/** Records the day the bank cleared a cheque (its receipt was « sous réserve »). Audited. */
export async function clearChargeCheque(ctx: TenantCtx, input: In<typeof clearChargeChequeSchema>) {
  assertCan(ctx, "payment:create");
  if (input.clearedOn > todayInAlgiers()) throw invalid("clearedOn", "charges.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({
        method: chargePayment.method,
        status: chargePayment.status,
        paidOn: chargePayment.paidOn,
        clearedOn: chargePayment.chequeClearedOn,
      })
      .from(chargePayment)
      .where(eq(chargePayment.id, input.paymentId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    if (current.method !== "cheque" || current.status !== "valid" || current.clearedOn) {
      throw new AppError("CONFLICT", "payments.errors.notPendingCheque");
    }
    if (input.clearedOn < current.paidOn) {
      throw invalid("clearedOn", "payments.errors.beforePayment");
    }
    await tx
      .update(chargePayment)
      .set({ chequeClearedOn: input.clearedOn })
      .where(eq(chargePayment.id, input.paymentId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_payment.cheque_cleared",
      entityType: "charge_payment",
      entityId: input.paymentId,
      after: { clearedOn: input.clearedOn },
    });
  });
}
