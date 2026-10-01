import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import { quotation, quotationLine, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { buildSchedule, netPrice } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleLead } from "@/server/crm/access";
import { recordLeadActivity } from "@/server/crm/activity";
import { advanceLeadStage } from "@/server/crm/leads";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { loadCompanyProfile } from "@/server/organizations/settings";
import { loadMilestones, loadPaymentPlans } from "@/server/payment-plans/queries";

import type { cancelQuotationSchema, issueQuotationSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Units a quotation can be made for: still on sale. */
const QUOTABLE = new Set(["available", "optioned"]);

/**
 * Issues a numbered quotation (DEV-YYYY-NNNNNN) for a lead and a unit, with the schedule of a
 * project payment plan applied to the net price. Snapshots prices and lines; the PDF job is
 * enqueued in the same transaction. The lead moves to "négociation".
 */
export async function issueQuotation(ctx: TenantCtx, input: In<typeof issueQuotationSchema>) {
  assertCan(ctx, "quotation:create");
  if (input.discount > 0n && !can(ctx.roles, "quotation:discount")) {
    throw new AppError("FORBIDDEN", "quotations.errors.discountForbidden");
  }
  return withTenant(ctx, async (tx) => {
    const lead = await loadVisibleLead(tx, ctx, input.leadId, { forUpdate: true });
    const [target] = await tx
      .select({
        projectId: unit.projectId,
        code: unit.code,
        status: unit.status,
        listPrice: unit.listPrice,
      })
      .from(unit)
      .where(and(eq(unit.id, input.unitId), isNull(unit.deletedAt)))
      .for("share");
    if (!target) throw new AppError("NOT_FOUND");
    if (!QUOTABLE.has(target.status)) {
      throw new AppError("CONFLICT", "quotations.errors.unitNotAvailable");
    }
    if (target.listPrice === null)
      throw new AppError("CONFLICT", "quotations.errors.unitNotPriced");
    if (input.discount > target.listPrice) {
      throw new AppError("VALIDATION", "quotations.errors.discountTooHigh", {
        fieldErrors: { discount: ["quotations.errors.discountTooHigh"] },
      });
    }

    const [plan] = await loadPaymentPlans(tx, target.projectId, [input.paymentPlanId]);
    if (!plan) {
      throw new AppError("VALIDATION", "quotations.errors.planNotFound", {
        fieldErrors: { paymentPlanId: ["quotations.errors.planNotFound"] },
      });
    }
    const milestones = await loadMilestones(tx, target.projectId);
    const company = await loadCompanyProfile(tx, ctx.orgId);

    const issuedAt = new Date();
    const signingOn = todayInAlgiers(issuedAt);
    const price = netPrice(target.listPrice, input.discount);
    const lines = buildSchedule(price, plan.steps, signingOn, milestones);
    const { number } = await nextDocumentNumber(tx, ctx, "quotation", issuedAt);

    const [row] = await tx
      .insert(quotation)
      .values({
        organizationId: ctx.orgId,
        number,
        leadId: lead.id,
        projectId: target.projectId,
        unitId: input.unitId,
        paymentPlanId: plan.id,
        listPrice: target.listPrice,
        discount: input.discount,
        price,
        issuedAt,
        signingOn,
        validUntil: addDays(signingOn, company.quotationValidityDays),
        issuedBy: ctx.userId,
        notes: input.notes,
      })
      .returning({ id: quotation.id });
    if (!row) throw new Error("issueQuotation: no row returned");
    await tx.insert(quotationLine).values(
      lines.map((line) => ({
        organizationId: ctx.orgId,
        quotationId: row.id,
        position: line.position,
        label: line.label,
        shareBp: line.shareBp,
        amount: line.amount,
        trigger: line.trigger,
        dueOn: line.dueOn,
        milestoneName: line.milestoneName,
      })),
    );

    await recordLeadActivity(tx, ctx, lead.id, "quotation_issued", {
      quotationId: row.id,
      number,
    });
    await advanceLeadStage(tx, ctx, lead, "negotiation");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "quotation.issue",
      entityType: "quotation",
      entityId: row.id,
      after: {
        number,
        unit: target.code,
        plan: plan.name,
        listPrice: target.listPrice,
        discount: input.discount,
        price,
      },
    });
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "quotation", id: row.id },
      { singletonKey: row.id },
    );
    return { id: row.id, number };
  });
}

/** Cancels an issued quotation (managers), with a reason. Its number is never reused. */
export async function cancelQuotation(ctx: TenantCtx, input: In<typeof cancelQuotationSchema>) {
  assertCan(ctx, "quotation:cancel");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ leadId: quotation.leadId, number: quotation.number, status: quotation.status })
      .from(quotation)
      .where(eq(quotation.id, input.quotationId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    if (current.status === "cancelled") {
      throw new AppError("CONFLICT", "quotations.errors.alreadyCancelled");
    }
    await tx
      .update(quotation)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: ctx.userId,
        cancellationReason: input.reason,
      })
      .where(eq(quotation.id, input.quotationId));
    await recordLeadActivity(tx, ctx, current.leadId, "quotation_cancelled", {
      quotationId: input.quotationId,
      number: current.number,
    });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "quotation.cancel",
      entityType: "quotation",
      entityId: input.quotationId,
      before: { status: "issued" },
      after: { status: "cancelled" },
      reason: input.reason,
    });
  });
}

/** Re-enqueues the PDF when it is missing (e.g. the worker was down); idempotent. */
export async function requestQuotationPdf(ctx: TenantCtx, quotationId: string) {
  assertCan(ctx, "lead:read");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ leadId: quotation.leadId, pdfFileId: quotation.pdfFileId })
      .from(quotation)
      .where(eq(quotation.id, quotationId));
    if (!row) throw new AppError("NOT_FOUND");
    await loadVisibleLead(tx, ctx, row.leadId);
    if (row.pdfFileId) return;
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "quotation", id: quotationId },
      { singletonKey: quotationId },
    );
  });
}
