import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";

import { installment, payment, receipt } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { computeStatement } from "@/lib/statement";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { loadVisibleReservation } from "@/server/sales/access";
import { paidTotals } from "@/server/sales/sale-queries";

import type { cancelPaymentSchema, clearChequeSchema, recordPaymentSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

const NO_PENALTY = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };

/**
 * Records a payment on a sale and issues its receipt REC-… in the same transaction (CLAUDE.md
 * §7). Oldest due installments first; a payment above the remaining balance is refused
 * (CLAUDE.md §12). The receipt keeps a snapshot of what the payment settled; its PDF is
 * rendered by the worker.
 */
export async function recordPayment(ctx: TenantCtx, input: In<typeof recordPaymentSchema>) {
  assertCan(ctx, "payment:create");
  if (input.paidOn > todayInAlgiers()) throw invalid("paidOn", "sales.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    // The row lock serializes payments on the same sale.
    const sale = await loadVisibleReservation(tx, ctx, input.reservationId, { forUpdate: true });
    if (sale.status === "withdrawn") throw new AppError("CONFLICT", "payments.errors.saleClosed");

    const installments = await tx
      .select({
        position: installment.position,
        label: installment.label,
        amount: installment.amount,
        dueOn: installment.dueOn,
      })
      .from(installment)
      .where(eq(installment.reservationId, sale.id))
      .orderBy(asc(installment.position));
    const paidBefore = (await paidTotals(tx, [sale.id])).get(sale.id) ?? 0n;
    if (input.amount > sale.price - paidBefore) {
      throw invalid("amount", "payments.errors.aboveBalance");
    }

    const today = todayInAlgiers();
    const before = computeStatement(installments, paidBefore, today, NO_PENALTY);
    const after = computeStatement(installments, paidBefore + input.amount, today, NO_PENALTY);
    const allocation = after.lines.flatMap((line) => {
      const previous = before.lines.find((l) => l.position === line.position)?.paid ?? 0n;
      const settled = line.paid - previous;
      return settled > 0n
        ? [{ position: line.position, label: line.label, amount: settled.toString() }]
        : [];
    });

    const [row] = await tx
      .insert(payment)
      .values({
        organizationId: ctx.orgId,
        reservationId: sale.id,
        amount: input.amount,
        method: input.method,
        paidOn: input.paidOn,
        reference: input.reference,
        bank: input.bank,
        payerName: input.payerName,
        notes: input.notes,
        recordedBy: ctx.userId,
      })
      .returning({ id: payment.id });
    if (!row) throw new Error("recordPayment: no row returned");
    const { number } = await nextDocumentNumber(tx, ctx, "receipt");
    const [issued] = await tx
      .insert(receipt)
      .values({
        organizationId: ctx.orgId,
        number,
        paymentId: row.id,
        issuedBy: ctx.userId,
        allocation,
      })
      .returning({ id: receipt.id });
    if (!issued) throw new Error("recordPayment: no receipt returned");

    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "payment.create",
      entityType: "payment",
      entityId: row.id,
      after: {
        reservation: sale.number,
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
      { organizationId: ctx.orgId, kind: "receipt", id: issued.id },
      { singletonKey: `receipt:${issued.id}` },
    );
    return { paymentId: row.id, receiptId: issued.id, receiptNumber: number };
  });
}

/**
 * Cancels a payment and its receipt with a reason (accountants; e.g. « chèque impayé »).
 * Payments are never deleted; the installments it settled are due again (derived statement).
 */
export async function cancelPayment(ctx: TenantCtx, input: In<typeof cancelPaymentSchema>) {
  assertCan(ctx, "payment:cancel");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({
        reservationId: payment.reservationId,
        status: payment.status,
        amount: payment.amount,
      })
      .from(payment)
      .where(eq(payment.id, input.paymentId));
    if (!current) throw new AppError("NOT_FOUND");
    await loadVisibleReservation(tx, ctx, current.reservationId, { forUpdate: true });
    if (current.status === "cancelled") {
      throw new AppError("CONFLICT", "payments.errors.alreadyCancelled");
    }
    const now = new Date();
    await tx
      .update(payment)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: ctx.userId,
        cancellationReason: input.reason,
      })
      .where(eq(payment.id, input.paymentId));
    await tx
      .update(receipt)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(receipt.paymentId, input.paymentId), eq(receipt.status, "issued")));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "payment.cancel",
      entityType: "payment",
      entityId: input.paymentId,
      before: { status: "valid", amount: current.amount },
      after: { status: "cancelled" },
      reason: input.reason,
    });
  });
}

/** Records the day a cheque was cleared by the bank (its receipt was « sous réserve »). */
export async function clearCheque(ctx: TenantCtx, input: In<typeof clearChequeSchema>) {
  assertCan(ctx, "payment:create");
  if (input.clearedOn > todayInAlgiers()) throw invalid("clearedOn", "sales.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({
        reservationId: payment.reservationId,
        method: payment.method,
        status: payment.status,
        paidOn: payment.paidOn,
        clearedOn: payment.chequeClearedOn,
      })
      .from(payment)
      .where(eq(payment.id, input.paymentId));
    if (!current) throw new AppError("NOT_FOUND");
    await loadVisibleReservation(tx, ctx, current.reservationId, { forUpdate: true });
    if (current.method !== "cheque" || current.status !== "valid" || current.clearedOn) {
      throw new AppError("CONFLICT", "payments.errors.notPendingCheque");
    }
    if (input.clearedOn < current.paidOn)
      throw invalid("clearedOn", "payments.errors.beforePayment");
    await tx
      .update(payment)
      .set({ chequeClearedOn: input.clearedOn })
      .where(eq(payment.id, input.paymentId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "payment.cheque_cleared",
      entityType: "payment",
      entityId: input.paymentId,
      after: { clearedOn: input.clearedOn },
    });
  });
}
