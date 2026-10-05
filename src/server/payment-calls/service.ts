import "server-only";

import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";

import { constructionMilestone, installment, paymentCall, project, reservation } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { computeStatement } from "@/lib/statement";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { loadSalesSettings } from "@/server/organizations/settings";
import { paidTotals } from "@/server/sales/sale-queries";
import { notifyPaymentCall } from "@/server/whatsapp/notify";

import type { validateMilestoneSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const NO_PENALTY = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };

/**
 * Records that a construction milestone is reached (CLAUDE.md §7): the installments tied to
 * it in live sales become due on the validation date + the company's payment-call delay (never
 * before their signing), and one job issues the payment calls. A validation is final.
 */
export async function validateMilestone(ctx: TenantCtx, input: In<typeof validateMilestoneSchema>) {
  assertCan(ctx, "milestone:validate");
  if (input.validatedOn > todayInAlgiers()) {
    throw new AppError("VALIDATION", "sales.errors.futureDate", {
      fieldErrors: { validatedOn: ["sales.errors.futureDate"] },
    });
  }
  return withTenant(ctx, async (tx) => {
    const [milestone] = await tx
      .select({
        id: constructionMilestone.id,
        name: constructionMilestone.name,
        validatedOn: constructionMilestone.validatedOn,
        projectName: project.name,
      })
      .from(constructionMilestone)
      .innerJoin(project, eq(project.id, constructionMilestone.projectId))
      .where(
        and(
          eq(constructionMilestone.id, input.milestoneId),
          isNull(constructionMilestone.deletedAt),
        ),
      )
      .for("update", { of: constructionMilestone });
    if (!milestone) throw new AppError("NOT_FOUND");
    if (milestone.validatedOn) {
      throw new AppError("CONFLICT", "paymentPlans.errors.alreadyValidated");
    }

    const settings = await loadSalesSettings(tx, ctx.orgId);
    const dueOn = addDays(input.validatedOn, settings.paymentCallDelayDays);
    await tx
      .update(constructionMilestone)
      .set({ validatedOn: input.validatedOn, validatedBy: ctx.userId })
      .where(eq(constructionMilestone.id, milestone.id));
    const scheduled = await tx
      .update(installment)
      .set({ dueOn: sql`greatest(${dueOn}::date, ${reservation.reservedOn})` })
      .from(reservation)
      .where(
        and(
          eq(installment.milestoneId, milestone.id),
          eq(reservation.id, installment.reservationId),
          ne(reservation.status, "withdrawn"),
        ),
      )
      .returning({ reservationId: installment.reservationId });

    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "milestone.validate",
      entityType: "construction_milestone",
      entityId: milestone.id,
      after: {
        project: milestone.projectName,
        milestone: milestone.name,
        validatedOn: input.validatedOn,
        dueOn,
        installments: scheduled.length,
      },
    });
    if (scheduled.length > 0) {
      await enqueueInTx(
        tx,
        "payment_call.issue",
        { organizationId: ctx.orgId, milestoneId: milestone.id },
        { singletonKey: `milestone:${milestone.id}` },
      );
    }
    return { dueOn, installments: scheduled.length };
  });
}

/**
 * Job `payment_call.issue`: one numbered call (ADF-…) per installment of the validated
 * milestone in each live sale, for what is still unpaid on it. Idempotent: an installment
 * already called, or already settled by earlier payments, gets no new call.
 */
export async function issueMilestonePaymentCalls(
  organizationId: string,
  milestoneId: string,
): Promise<number> {
  const scope = { orgId: organizationId };
  return withTenant(scope, async (tx) => {
    const [milestone] = await tx
      .select({ validatedOn: constructionMilestone.validatedOn })
      .from(constructionMilestone)
      .where(eq(constructionMilestone.id, milestoneId));
    if (!milestone?.validatedOn) return 0;

    const targets = await tx
      .select({
        reservationId: installment.reservationId,
        position: installment.position,
        label: installment.label,
        amount: installment.amount,
        dueOn: installment.dueOn,
      })
      .from(installment)
      .innerJoin(reservation, eq(reservation.id, installment.reservationId))
      .where(and(eq(installment.milestoneId, milestoneId), ne(reservation.status, "withdrawn")))
      .orderBy(asc(reservation.number), asc(installment.position));
    const today = todayInAlgiers();

    let issued = 0;
    for (const saleId of new Set(targets.map((t) => t.reservationId))) {
      // Locks the sale first: its payments and calls are read and written serially.
      await tx
        .select({ id: reservation.id })
        .from(reservation)
        .where(eq(reservation.id, saleId))
        .for("update");
      const called = await tx
        .select({ position: paymentCall.installmentPosition })
        .from(paymentCall)
        .where(eq(paymentCall.reservationId, saleId));
      const paid = (await paidTotals(tx, [saleId])).get(saleId) ?? 0n;
      const installments = await tx
        .select({
          position: installment.position,
          label: installment.label,
          amount: installment.amount,
          dueOn: installment.dueOn,
        })
        .from(installment)
        .where(eq(installment.reservationId, saleId))
        .orderBy(asc(installment.position));
      const statement = computeStatement(installments, paid, today, NO_PENALTY);
      for (const target of targets.filter((t) => t.reservationId === saleId)) {
        if (called.some((c) => c.position === target.position)) continue;
        const line = statement.lines.find((l) => l.position === target.position);
        if (!line || line.remaining === 0n || !target.dueOn) continue;
        const { number } = await nextDocumentNumber(tx, scope, "payment_call");
        const [row] = await tx
          .insert(paymentCall)
          .values({
            organizationId,
            number,
            reservationId: saleId,
            milestoneId,
            installmentPosition: target.position,
            label: target.label,
            amount: target.amount,
            settled: target.amount - line.remaining,
            called: line.remaining,
            dueOn: target.dueOn,
          })
          .returning({ id: paymentCall.id });
        if (!row) throw new Error("issueMilestonePaymentCalls: no row returned");
        await enqueueInTx(
          tx,
          "pdf.document",
          { organizationId, kind: "payment_call", id: row.id },
          { singletonKey: `payment_call:${row.id}` },
        );
        await notifyPaymentCall(tx, scope, saleId, {
          number,
          amount: line.remaining,
          dueOn: target.dueOn,
        });
        issued += 1;
      }
    }
    return issued;
  });
}
