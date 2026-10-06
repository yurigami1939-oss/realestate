import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { type AmendmentLine, installment, scheduleAmendment, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { allocate, formatDZD, sumCentimes } from "@/lib/money";
import { FULL_SHARE_BP } from "@/lib/payment-plans";
import { AppError } from "@/lib/result";
import { computeStatement } from "@/lib/statement";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadMilestones } from "@/server/payment-plans/queries";

import { loadVisibleReservation } from "./access";
import { paidTotals } from "./sale-queries";
import type { rescheduleSaleSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const NO_PENALTIES = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };

const invalid = (
  field: string,
  messageKey: string,
  details?: Record<string, string | number | boolean | null>,
) => new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] }, details });

/**
 * Avenant (CLAUDE.md §7): on a live sale, the installments not fully paid are replaced by new
 * lines — due on a day from the amendment on, or at a milestone not reached yet — whose total
 * is what those lines amounted to; paid lines stay. Payments keep counting FIFO over the new
 * schedule. Numbered per sale, audited, bilingual PDF filed under the sale.
 */
export async function rescheduleSale(ctx: TenantCtx, input: In<typeof rescheduleSaleSchema>) {
  assertCan(ctx, "sale:update");
  if (input.signedOn > todayInAlgiers()) throw invalid("signedOn", "sales.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, input.reservationId, { forUpdate: true });
    if (sale.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
    if (input.signedOn < sale.reservedOn) {
      throw invalid("signedOn", "sales.errors.amendmentBeforeReservation");
    }

    const current = await tx
      .select({
        position: installment.position,
        label: installment.label,
        shareBp: installment.shareBp,
        amount: installment.amount,
        dueOn: installment.dueOn,
        milestoneId: installment.milestoneId,
      })
      .from(installment)
      .where(eq(installment.reservationId, sale.id))
      .orderBy(asc(installment.position));
    const paid = (await paidTotals(tx, [sale.id])).get(sale.id) ?? 0n;
    const statement = computeStatement(current, paid, input.signedOn, NO_PENALTIES);
    const kept = statement.lines.filter((l) => l.remaining === 0n);
    const replaced = statement.lines.filter((l) => l.remaining > 0n);
    if (replaced.length === 0) {
      throw new AppError("CONFLICT", "sales.errors.nothingToReschedule");
    }
    const expected = sumCentimes(replaced.map((l) => l.amount));
    const total = sumCentimes(input.lines.map((l) => l.amount));
    if (total !== expected) {
      throw invalid("lines", "sales.errors.amendmentTotal", {
        expected: formatDZD(expected, ctx.locale),
      });
    }

    const milestones = await loadMilestones(tx, sale.projectId);
    const milestoneName = (id: string | null) =>
      id ? (milestones.find((m) => m.id === id)?.name ?? null) : null;
    input.lines.forEach((line, index) => {
      if (line.milestoneId) {
        const milestone = milestones.find((m) => m.id === line.milestoneId);
        if (!milestone) throw invalid(`lines.${index}.milestoneId`, "sales.errors.milestone");
        if (milestone.validatedOn) {
          throw invalid(`lines.${index}.milestoneId`, "sales.errors.milestoneReached");
        }
      } else if (line.dueOn && line.dueOn < input.signedOn) {
        throw invalid(`lines.${index}.dueOn`, "sales.errors.beforeAmendment");
      }
    });

    // New lines numbered after every existing one (payment calls are keyed by position).
    const next = Math.max(...current.map((l) => l.position)) + 1;
    const shareLeft = FULL_SHARE_BP - kept.reduce((sum, l) => sum + l.shareBp, 0);
    const shares = allocate(
      BigInt(shareLeft),
      input.lines.map((l) => l.amount),
    );
    await tx.delete(installment).where(
      and(
        eq(installment.reservationId, sale.id),
        inArray(
          installment.position,
          replaced.map((l) => l.position),
        ),
      ),
    );
    await tx.insert(installment).values(
      input.lines.map((line, index) => ({
        organizationId: ctx.orgId,
        reservationId: sale.id,
        position: next + index,
        label: line.label,
        shareBp: Number(shares[index] ?? 0n),
        amount: line.amount,
        trigger: line.milestoneId ? ("milestone" as const) : ("months_after_signing" as const),
        months: null,
        milestoneId: line.milestoneId,
        dueOn: line.dueOn,
      })),
    );

    const snapshot = (l: {
      label: string;
      amount: bigint;
      dueOn: string | null;
      milestoneId: string | null;
    }): AmendmentLine => ({
      label: l.label,
      amount: l.amount.toString(),
      dueOn: l.dueOn,
      milestoneName: milestoneName(l.milestoneId),
    });
    const [{ sequence } = { sequence: 1 }] = await tx
      .select({ sequence: sql<number>`coalesce(max(${scheduleAmendment.sequence}), 0)::int + 1` })
      .from(scheduleAmendment)
      .where(eq(scheduleAmendment.reservationId, sale.id));
    const [row] = await tx
      .insert(scheduleAmendment)
      .values({
        organizationId: ctx.orgId,
        reservationId: sale.id,
        sequence,
        signedOn: input.signedOn,
        reason: input.reason,
        paid,
        replaced: replaced.map(snapshot),
        lines: input.lines.map(snapshot),
        createdBy: ctx.userId,
      })
      .returning({ id: scheduleAmendment.id });
    if (!row) throw new Error("rescheduleSale: no row returned");

    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "reservation.reschedule",
      entityType: "reservation",
      entityId: sale.id,
      before: { lines: replaced.map(snapshot) },
      after: { amendment: sequence, signedOn: input.signedOn, lines: input.lines.map(snapshot) },
      reason: input.reason,
    });
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "schedule_amendment", id: row.id },
      { singletonKey: row.id },
    );
    return { id: row.id, sequence };
  });
}

/** Amendments of a visible sale, newest first (sale page and portal follow the sale). */
export async function listSaleAmendments(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return [];
  return withTenant(ctx, async (tx) => {
    await loadVisibleReservation(tx, ctx, reservationId);
    return tx
      .select({
        id: scheduleAmendment.id,
        sequence: scheduleAmendment.sequence,
        signedOn: scheduleAmendment.signedOn,
        reason: scheduleAmendment.reason,
        lines: scheduleAmendment.lines,
        createdByName: user.name,
        pdfFileId: scheduleAmendment.pdfFileId,
      })
      .from(scheduleAmendment)
      .innerJoin(user, eq(user.id, scheduleAmendment.createdBy))
      .where(eq(scheduleAmendment.reservationId, reservationId))
      .orderBy(desc(scheduleAmendment.sequence));
  });
}

export type SaleAmendment = Awaited<ReturnType<typeof listSaleAmendments>>[number];
