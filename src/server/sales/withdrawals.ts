import "server-only";

import { and, asc, desc, eq, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  commission,
  handover,
  installment,
  reminderLetter,
  reservation,
  user,
  withdrawal,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { applyRate } from "@/lib/money";
import { AppError } from "@/lib/result";
import { computeStatement } from "@/lib/statement";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { recordLeadActivity } from "@/server/crm/activity";
import { transitionUnit } from "@/server/inventory/transition-unit";
import { loadSalesSettings } from "@/server/organizations/settings";
import { cancelPartnerCommission } from "@/server/partners/service";
import { resolvePaymentAccount } from "@/server/treasury/service";

import { loadVisibleReservation } from "./access";
import { paidTotals } from "./sale-queries";
import type {
  decideWithdrawalSchema,
  proposeWithdrawalSchema,
  recordWithdrawalRefundSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Retention on the amount paid (half-up to the centime) and what is refunded. */
function split(paid: bigint, retentionBp: number) {
  const retention = applyRate(paid, retentionBp);
  return { paid, retention, refund: paid - retention };
}

async function loadWithdrawal(tx: Tx, ctx: TenantCtx, withdrawalId: string) {
  const [row] = await tx
    .select()
    .from(withdrawal)
    .where(eq(withdrawal.id, withdrawalId))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  const sale = await loadVisibleReservation(tx, ctx, row.reservationId, { forUpdate: true });
  return { row, sale };
}

const NO_PENALTIES = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };

/**
 * A termination for non-payment needs (CLAUDE.md §7): something overdue today, no handover
 * started, and the company's number of formal notices whose delay is over.
 */
async function assertTerminable(tx: Tx, ctx: TenantCtx, saleId: string) {
  const today = todayInAlgiers();
  const lines = await tx
    .select({
      position: installment.position,
      label: installment.label,
      amount: installment.amount,
      dueOn: installment.dueOn,
    })
    .from(installment)
    .where(eq(installment.reservationId, saleId))
    .orderBy(asc(installment.position));
  const paid = (await paidTotals(tx, [saleId])).get(saleId) ?? 0n;
  if (computeStatement(lines, paid, today, NO_PENALTIES).overdue === 0n) {
    throw new AppError("CONFLICT", "sales.errors.notOverdue");
  }
  const [started] = await tx
    .select({ id: handover.id })
    .from(handover)
    .where(eq(handover.reservationId, saleId));
  if (started) throw new AppError("CONFLICT", "sales.errors.handoverStarted");
  const { formalNoticesRequired } = await loadSalesSettings(tx, ctx.orgId);
  const [notices] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(reminderLetter)
    .where(
      and(
        eq(reminderLetter.reservationId, saleId),
        eq(reminderLetter.kind, "formal_notice"),
        lt(reminderLetter.payBy, today),
      ),
    );
  if ((notices?.n ?? 0) < formalNoticesRequired) {
    throw new AppError("CONFLICT", "sales.errors.noticesMissing");
  }
}

/**
 * Proposes a withdrawal (désistement) of a reservation (CLAUDE.md §12): retention on the amount
 * paid, prefilled with the company default and editable, with a reason. The gérant decides.
 * Only reservations before the VSP; one open proposal at a time. A termination for non-payment
 * (kind `termination`) also applies to a sold sale, once formal notices went unanswered.
 */
export async function proposeWithdrawal(ctx: TenantCtx, input: In<typeof proposeWithdrawalSchema>) {
  assertCan(ctx, "sale:withdraw");
  return withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, input.reservationId, { forUpdate: true });
    if (input.kind === "termination") {
      if (sale.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
    } else if (sale.status !== "reserved") {
      throw new AppError("CONFLICT", "sales.errors.notReserved");
    }
    const [open] = await tx
      .select({ id: withdrawal.id })
      .from(withdrawal)
      .where(and(eq(withdrawal.reservationId, sale.id), ne(withdrawal.status, "rejected")));
    if (open) throw new AppError("CONFLICT", "sales.withdrawal.errors.alreadyOpen");
    if (input.kind === "termination") await assertTerminable(tx, ctx, sale.id);
    const amounts = split((await paidTotals(tx, [sale.id])).get(sale.id) ?? 0n, input.retention);
    const [row] = await tx
      .insert(withdrawal)
      .values({
        organizationId: ctx.orgId,
        reservationId: sale.id,
        kind: input.kind,
        reason: input.reason,
        retentionBp: input.retention,
        ...amounts,
        proposedBy: ctx.userId,
      })
      .returning({ id: withdrawal.id });
    if (!row) throw new Error("proposeWithdrawal: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "withdrawal.propose",
      entityType: "reservation",
      entityId: sale.id,
      after: { number: sale.number, kind: input.kind, retentionBp: input.retention, ...amounts },
      reason: input.reason,
    });
    return { id: row.id, ...amounts };
  });
}

/**
 * The gérant approves or rejects a proposed withdrawal. Approval recomputes the amounts on
 * what is paid now, ends the reservation and releases the unit; payments stay (the refund is
 * recorded when paid out).
 */
export async function decideWithdrawal(ctx: TenantCtx, input: In<typeof decideWithdrawalSchema>) {
  assertCan(ctx, "sale:approve");
  await withTenant(ctx, async (tx) => {
    const { row, sale } = await loadWithdrawal(tx, ctx, input.withdrawalId);
    if (row.status !== "proposed") {
      throw new AppError("CONFLICT", "sales.withdrawal.errors.notProposed");
    }
    const now = new Date();
    if (!input.approve) {
      if (!input.note) {
        throw new AppError("VALIDATION", "validation.required", {
          fieldErrors: { note: ["validation.required"] },
        });
      }
      await tx
        .update(withdrawal)
        .set({
          status: "rejected",
          decidedBy: ctx.userId,
          decidedAt: now,
          decisionNote: input.note,
        })
        .where(eq(withdrawal.id, row.id));
      await recordAudit(tx, ctx, {
        actorUserId: ctx.userId,
        action: "withdrawal.reject",
        entityType: "reservation",
        entityId: sale.id,
        reason: input.note,
      });
      return;
    }
    if (row.kind === "termination") {
      if (sale.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
      const [started] = await tx
        .select({ id: handover.id })
        .from(handover)
        .where(eq(handover.reservationId, sale.id));
      if (started) throw new AppError("CONFLICT", "sales.errors.handoverStarted");
    } else if (sale.status !== "reserved") {
      throw new AppError("CONFLICT", "sales.errors.notReserved");
    }

    const amounts = split((await paidTotals(tx, [sale.id])).get(sale.id) ?? 0n, row.retentionBp);
    await tx
      .update(withdrawal)
      .set({
        status: "approved",
        ...amounts,
        decidedBy: ctx.userId,
        decidedAt: now,
        decisionNote: input.note,
      })
      .where(eq(withdrawal.id, row.id));
    await tx
      .update(reservation)
      .set({ status: "withdrawn", endedOn: todayInAlgiers() })
      .where(eq(reservation.id, sale.id));
    await tx
      .update(commission)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: ctx.userId,
        cancelReason: row.reason,
      })
      .where(and(eq(commission.reservationId, sale.id), eq(commission.status, "earned")));
    await cancelPartnerCommission(tx, ctx, sale.id, row.reason);
    await transitionUnit(tx, ctx, sale.unitId, "available", {
      reason: row.reason,
      refType: "reservation",
      refId: sale.id,
    });
    if (sale.leadId) {
      await recordLeadActivity(
        tx,
        ctx,
        sale.leadId,
        row.kind === "termination" ? "terminated" : "withdrawn",
        { number: sale.number },
      );
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "withdrawal.approve",
      entityType: "reservation",
      entityId: sale.id,
      before: { status: sale.status },
      after: { status: "withdrawn", kind: row.kind, retentionBp: row.retentionBp, ...amounts },
      reason: row.reason,
    });
  });
}

/** Records that the refund of an approved withdrawal was paid out (cashier, accountant). */
export async function recordWithdrawalRefund(
  ctx: TenantCtx,
  input: In<typeof recordWithdrawalRefundSchema>,
) {
  assertCan(ctx, "payment:create");
  if (input.refundedOn > todayInAlgiers()) {
    throw new AppError("VALIDATION", "sales.errors.futureDate", {
      fieldErrors: { refundedOn: ["sales.errors.futureDate"] },
    });
  }
  await withTenant(ctx, async (tx) => {
    const { row, sale } = await loadWithdrawal(tx, ctx, input.withdrawalId);
    if (row.status !== "approved" || row.refundedOn !== null || row.refund === 0n) {
      throw new AppError("CONFLICT", "sales.withdrawal.errors.noRefundDue");
    }
    const accountId = await resolvePaymentAccount(tx, input.method, input.accountId);
    await tx
      .update(withdrawal)
      .set({
        refundedOn: input.refundedOn,
        refundMethod: input.method,
        refundReference: input.reference,
        refundRecordedBy: ctx.userId,
        refundAccountId: accountId,
      })
      .where(eq(withdrawal.id, row.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "withdrawal.refund",
      entityType: "reservation",
      entityId: sale.id,
      after: {
        refund: row.refund,
        refundedOn: input.refundedOn,
        method: input.method,
        reference: input.reference,
        accountId,
      },
    });
  });
}

const proposer = alias(user, "proposer");
const decider = alias(user, "decider");

/** Withdrawals of a visible sale, most recent first (sale page). */
export async function listSaleWithdrawals(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return [];
  return withTenant(ctx, async (tx) => {
    await loadVisibleReservation(tx, ctx, reservationId);
    return tx
      .select({
        id: withdrawal.id,
        kind: withdrawal.kind,
        status: withdrawal.status,
        reason: withdrawal.reason,
        retentionBp: withdrawal.retentionBp,
        paid: withdrawal.paid,
        retention: withdrawal.retention,
        refund: withdrawal.refund,
        proposedAt: withdrawal.proposedAt,
        proposedByName: proposer.name,
        decidedAt: withdrawal.decidedAt,
        decidedByName: decider.name,
        decisionNote: withdrawal.decisionNote,
        refundedOn: withdrawal.refundedOn,
        refundMethod: withdrawal.refundMethod,
        refundReference: withdrawal.refundReference,
      })
      .from(withdrawal)
      .innerJoin(proposer, eq(proposer.id, withdrawal.proposedBy))
      .leftJoin(decider, eq(decider.id, withdrawal.decidedBy))
      .where(eq(withdrawal.reservationId, reservationId))
      .orderBy(desc(withdrawal.proposedAt));
  });
}

export type SaleWithdrawal = Awaited<ReturnType<typeof listSaleWithdrawals>>[number];
