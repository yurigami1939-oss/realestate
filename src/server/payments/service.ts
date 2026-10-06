import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { installment, payment, receipt, type reservation } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import { AppError } from "@/lib/result";
import type { PaymentMethod } from "@/lib/sales";
import { computeStatement } from "@/lib/statement";
import { recordAudit } from "@/server/audit/record-audit";
import { resolvePaymentAccount } from "@/server/treasury/service";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { loadVisibleReservation } from "@/server/sales/access";
import { paidTotals } from "@/server/sales/sale-queries";
import { notifySalePayment } from "@/server/whatsapp/notify";

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
    return insertSalePayment(tx, ctx, sale, input);
  });
}

export type SalePaymentEntry = {
  amount: Centimes;
  method: PaymentMethod;
  paidOn: CalendarDate;
  reference: string | null;
  bank: string | null;
  payerName: string;
  notes: string | null;
  /** The account chosen; absent or empty = the method's default account. */
  accountId?: string | null;
};

/**
 * Inserts a payment and its receipt on a sale the caller has locked (`FOR UPDATE`): counter
 * payments and confirmed online payments (CLAUDE.md §7 Online payment). Refused on a closed sale
 * and above the remaining balance. `audit` is added to the audit entry.
 */
export async function insertSalePayment(
  tx: Tx,
  actor: { orgId: string; userId: string },
  sale: Pick<typeof reservation.$inferSelect, "id" | "number" | "status" | "price">,
  input: SalePaymentEntry,
  audit: Record<string, unknown> = {},
) {
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
      organizationId: actor.orgId,
      reservationId: sale.id,
      amount: input.amount,
      method: input.method,
      paidOn: input.paidOn,
      reference: input.reference,
      bank: input.bank,
      payerName: input.payerName,
      notes: input.notes,
      accountId: await resolvePaymentAccount(tx, input.method, input.accountId),
      recordedBy: actor.userId,
    })
    .returning({ id: payment.id });
  if (!row) throw new Error("recordPayment: no row returned");
  const { number } = await nextDocumentNumber(tx, actor, "receipt");
  const [issued] = await tx
    .insert(receipt)
    .values({
      organizationId: actor.orgId,
      number,
      paymentId: row.id,
      issuedBy: actor.userId,
      allocation,
    })
    .returning({ id: receipt.id });
  if (!issued) throw new Error("recordPayment: no receipt returned");

  await recordAudit(tx, actor, {
    actorUserId: actor.userId,
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
      ...audit,
    },
  });
  await enqueueInTx(
    tx,
    "pdf.document",
    { organizationId: actor.orgId, kind: "receipt", id: issued.id },
    { singletonKey: `receipt:${issued.id}` },
  );
  await notifySalePayment(tx, actor, sale.id, { amount: input.amount, receiptNumber: number });
  return { paymentId: row.id, receiptId: issued.id, receiptNumber: number };
}

/**
 * Cancels a payment and its receipt with a reason (accountants; e.g. « chèque impayé »).
 * Payments are never deleted; the installments it settled are due again (derived statement).
 * `outer`: the caller's transaction (refund of an online payment).
 */
export async function cancelPayment(
  ctx: TenantCtx,
  input: In<typeof cancelPaymentSchema>,
  outer?: Tx,
) {
  assertCan(ctx, "payment:cancel");
  await withTenant(
    ctx,
    async (tx) => {
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
    },
    outer,
  );
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
