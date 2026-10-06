import "server-only";

import { and, eq, gte, inArray, isNull, max } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { discountRequest, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { DISCOUNT_APPROVAL_DAYS } from "@/lib/discounts";
import type { Centimes } from "@/lib/money";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleLead } from "@/server/crm/access";
import { recordLeadActivity } from "@/server/crm/activity";

import type {
  decideDiscountSchema,
  discountRequestIdSchema,
  requestDiscountSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** Units a discount can be asked for: still on sale and priced. */
const ON_SALE = new Set(["available", "optioned"]);

/**
 * A commercial asks a manager for a discount on a unit for one of their leads (CLAUDE.md §7):
 * the unit is on sale and priced, the amount at most its list price; one pending request per
 * lead and unit. Written on the lead's timeline and audited.
 */
export async function requestDiscount(ctx: TenantCtx, input: In<typeof requestDiscountSchema>) {
  assertCan(ctx, "discount:request");
  return withTenant(ctx, async (tx) => {
    const lead = await loadVisibleLead(tx, ctx, input.leadId, { forUpdate: true });
    const [target] = await tx
      .select({ code: unit.code, status: unit.status, listPrice: unit.listPrice })
      .from(unit)
      .where(and(eq(unit.id, input.unitId), isNull(unit.deletedAt)));
    if (!target) throw invalid("unitId", "crm.errors.unitNotFound");
    if (!ON_SALE.has(target.status)) {
      throw invalid("unitId", "quotations.errors.unitNotAvailable");
    }
    if (target.listPrice === null) throw invalid("unitId", "quotations.errors.unitNotPriced");
    if (input.amount <= 0n) throw invalid("amount", "discounts.errors.amountPositive");
    if (input.amount > target.listPrice)
      throw invalid("amount", "quotations.errors.discountTooHigh");
    const [pending] = await tx
      .select({ id: discountRequest.id })
      .from(discountRequest)
      .where(
        and(
          eq(discountRequest.leadId, lead.id),
          eq(discountRequest.unitId, input.unitId),
          eq(discountRequest.status, "pending"),
        ),
      );
    if (pending) throw new AppError("CONFLICT", "discounts.errors.alreadyPending");

    const [row] = await tx
      .insert(discountRequest)
      .values({
        organizationId: ctx.orgId,
        leadId: lead.id,
        unitId: input.unitId,
        amount: input.amount,
        listPrice: target.listPrice,
        reason: input.reason,
        requestedBy: ctx.userId,
      })
      .returning({ id: discountRequest.id });
    if (!row) throw new Error("requestDiscount: no row returned");
    await recordLeadActivity(tx, ctx, lead.id, "discount_requested", {
      requestId: row.id,
      unitCode: target.code,
      amount: input.amount.toString(),
    });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "discount_request.create",
      entityType: "discount_request",
      entityId: row.id,
      after: {
        lead: lead.fullName,
        unit: target.code,
        listPrice: target.listPrice,
        amount: input.amount,
      },
      reason: input.reason,
    });
    return { id: row.id };
  });
}

async function loadPending(tx: Tx, ctx: TenantCtx, requestId: string) {
  const [row] = await tx
    .select({
      id: discountRequest.id,
      leadId: discountRequest.leadId,
      unitId: discountRequest.unitId,
      amount: discountRequest.amount,
      status: discountRequest.status,
      requestedBy: discountRequest.requestedBy,
      unitCode: unit.code,
      unitStatus: unit.status,
    })
    .from(discountRequest)
    .innerJoin(unit, eq(unit.id, discountRequest.unitId))
    .where(eq(discountRequest.id, requestId))
    .for("update", { of: discountRequest });
  if (!row) throw new AppError("NOT_FOUND");
  // The request follows its lead's visibility (a commercial sees their own leads).
  await loadVisibleLead(tx, ctx, row.leadId);
  if (row.status !== "pending") {
    throw new AppError("INVALID_TRANSITION", "discounts.errors.notPending");
  }
  return row;
}

/**
 * A manager decides a pending request (`discount:decide`): approved for the amount asked or
 * less, usable for DISCOUNT_APPROVAL_DAYS days; rejected with a note. Written on the lead's
 * timeline and audited.
 */
export async function decideDiscount(ctx: TenantCtx, input: In<typeof decideDiscountSchema>) {
  assertCan(ctx, "discount:decide");
  if (!input.approve && !input.note) throw invalid("note", "discounts.errors.noteRequired");
  return withTenant(ctx, async (tx) => {
    const request = await loadPending(tx, ctx, input.requestId);
    const approvedAmount = input.approve ? (input.amount ?? request.amount) : null;
    if (approvedAmount !== null) {
      if (approvedAmount <= 0n) throw invalid("amount", "discounts.errors.amountPositive");
      if (approvedAmount > request.amount) {
        throw invalid("amount", "discounts.errors.moreThanAsked");
      }
      if (!ON_SALE.has(request.unitStatus)) {
        throw new AppError("CONFLICT", "quotations.errors.unitNotAvailable");
      }
    }
    const decidedAt = new Date();
    const validUntil = input.approve
      ? addDays(todayInAlgiers(decidedAt), DISCOUNT_APPROVAL_DAYS)
      : null;
    await tx
      .update(discountRequest)
      .set({
        status: input.approve ? "approved" : "rejected",
        decidedBy: ctx.userId,
        decidedAt,
        approvedAmount,
        validUntil,
        decisionNote: input.note,
      })
      .where(eq(discountRequest.id, request.id));
    await recordLeadActivity(tx, ctx, request.leadId, "discount_decided", {
      requestId: request.id,
      unitCode: request.unitCode,
      approved: input.approve,
      amount: (approvedAmount ?? request.amount).toString(),
      note: input.note,
    });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: input.approve ? "discount_request.approve" : "discount_request.reject",
      entityType: "discount_request",
      entityId: request.id,
      before: { status: "pending", amount: request.amount },
      after: { status: input.approve ? "approved" : "rejected", approvedAmount, validUntil },
      reason: input.note ?? undefined,
    });
  });
}

/** The commercial who asked (or a manager) withdraws a pending request. */
export async function cancelDiscountRequest(
  ctx: TenantCtx,
  input: In<typeof discountRequestIdSchema>,
) {
  return withTenant(ctx, async (tx) => {
    const request = await loadPending(tx, ctx, input.requestId);
    if (request.requestedBy !== ctx.userId && !can(ctx.roles, "discount:decide")) {
      throw new AppError("FORBIDDEN");
    }
    await tx
      .update(discountRequest)
      .set({ status: "cancelled", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(eq(discountRequest.id, request.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "discount_request.cancel",
      entityType: "discount_request",
      entityId: request.id,
      before: { status: "pending" },
      after: { status: "cancelled" },
    });
  });
}

/**
 * Largest discount approved and still valid today for one of these leads on this unit (0 when
 * none): what a member without the discount right may grant on a quotation or a reservation.
 */
export async function approvedDiscount(
  tx: Tx,
  leadIds: string[],
  unitId: string,
): Promise<Centimes> {
  if (leadIds.length === 0) return 0n;
  const [row] = await tx
    .select({ amount: max(discountRequest.approvedAmount) })
    .from(discountRequest)
    .where(
      and(
        inArray(discountRequest.leadId, leadIds),
        eq(discountRequest.unitId, unitId),
        eq(discountRequest.status, "approved"),
        gte(discountRequest.validUntil, todayInAlgiers()),
      ),
    );
  return row?.amount ?? 0n;
}

/**
 * The discount rule of quotations and reservations (CLAUDE.md §7): managers (`right`) discount
 * freely; anyone else up to a discount approved for that lead and unit.
 */
export async function assertDiscountAllowed(
  tx: Tx,
  ctx: TenantCtx,
  right: "quotation:discount" | "sale:discount",
  discount: Centimes,
  leadIds: string[],
  unitId: string,
) {
  if (discount <= 0n || can(ctx.roles, right)) return;
  const approved = await approvedDiscount(tx, leadIds, unitId);
  if (approved === 0n) throw new AppError("FORBIDDEN", "quotations.errors.discountForbidden");
  if (discount > approved) throw invalid("discount", "discounts.errors.aboveApproved");
}
