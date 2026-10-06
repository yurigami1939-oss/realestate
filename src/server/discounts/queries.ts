import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Tx } from "@/db/client";
import { discountRequest, lead, project, unit, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { type DiscountRequestState, discountRequestState } from "@/lib/discounts";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { visibleLeads } from "@/server/crm/access";

import type { DiscountListParams } from "./schemas";

export const DISCOUNT_PAGE_SIZE = 50;

const requester = alias(user, "requester");
const decider = alias(user, "decider");

function selectRequests(tx: Tx) {
  return tx
    .select({
      id: discountRequest.id,
      leadId: discountRequest.leadId,
      leadName: lead.fullName,
      unitId: discountRequest.unitId,
      unitCode: unit.code,
      projectId: unit.projectId,
      projectName: project.name,
      listPrice: discountRequest.listPrice,
      currentListPrice: unit.listPrice,
      amount: discountRequest.amount,
      reason: discountRequest.reason,
      status: discountRequest.status,
      requestedBy: discountRequest.requestedBy,
      requesterName: requester.name,
      requestedAt: discountRequest.requestedAt,
      deciderName: decider.name,
      decidedAt: discountRequest.decidedAt,
      approvedAmount: discountRequest.approvedAmount,
      validUntil: discountRequest.validUntil,
      decisionNote: discountRequest.decisionNote,
    })
    .from(discountRequest)
    .innerJoin(lead, eq(lead.id, discountRequest.leadId))
    .innerJoin(unit, eq(unit.id, discountRequest.unitId))
    .innerJoin(project, eq(project.id, unit.projectId))
    .innerJoin(requester, eq(requester.id, discountRequest.requestedBy))
    .leftJoin(decider, eq(decider.id, discountRequest.decidedBy));
}

type RequestRow = Awaited<ReturnType<ReturnType<typeof selectRequests>["execute"]>>[number];

const withState = (today: string) => (row: RequestRow) => ({
  ...row,
  state: discountRequestState(row, today),
});

export type DiscountRequestRow = ReturnType<ReturnType<typeof withState>>;

/** Discount requests of a lead, newest first (lead sheet; follows the lead's visibility). */
export async function listLeadDiscountRequests(ctx: TenantCtx, leadId: string) {
  assertCan(ctx, "lead:read");
  if (!isUuid(leadId)) return [];
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) =>
    (
      await selectRequests(tx)
        .where(and(eq(discountRequest.leadId, leadId), visibleLeads(ctx)))
        .orderBy(desc(discountRequest.requestedAt))
    ).map(withState(today)),
  );
}

/** SQL condition of a shown state (`expired` is derived from the last valid day). */
function stateWhere(state: DiscountRequestState, today: string): SQL | undefined {
  switch (state) {
    case "approved":
      return and(eq(discountRequest.status, "approved"), gte(discountRequest.validUntil, today));
    case "expired":
      return and(eq(discountRequest.status, "approved"), lt(discountRequest.validUntil, today));
    case "pending":
    case "rejected":
    case "cancelled":
      return eq(discountRequest.status, state);
  }
}

/** Managers' list (`discount:decide`): pending first by default, oldest first. */
export async function listDiscountRequests(ctx: TenantCtx, params: DiscountListParams) {
  assertCan(ctx, "discount:decide");
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const where = and(
      params.state === "all" ? undefined : stateWhere(params.state, today),
      visibleLeads(ctx),
    );
    const rows = await selectRequests(tx)
      .where(where)
      .orderBy(
        params.state === "pending"
          ? asc(discountRequest.requestedAt)
          : desc(discountRequest.requestedAt),
      )
      .limit(DISCOUNT_PAGE_SIZE)
      .offset((params.page - 1) * DISCOUNT_PAGE_SIZE);
    const [total] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(discountRequest)
      .innerJoin(lead, eq(lead.id, discountRequest.leadId))
      .where(where);
    return {
      rows: rows.map(withState(today)),
      total: total?.n ?? 0,
      page: params.page,
      pageSize: DISCOUNT_PAGE_SIZE,
    };
  });
}

/**
 * Discounts approved and still valid for these leads (quotation and reservation forms): the
 * largest per lead and unit. Empty for managers, who discount freely.
 */
export async function listApprovedDiscounts(ctx: TenantCtx, leadIds?: string[]) {
  assertCan(ctx, "lead:read");
  if (leadIds && leadIds.length === 0) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        leadId: discountRequest.leadId,
        unitId: discountRequest.unitId,
        amount: sql<string>`max(${discountRequest.approvedAmount})::text`.mapWith(BigInt),
      })
      .from(discountRequest)
      .innerJoin(lead, eq(lead.id, discountRequest.leadId))
      .where(
        and(
          eq(discountRequest.status, "approved"),
          gte(discountRequest.validUntil, todayInAlgiers()),
          isNull(lead.deletedAt),
          leadIds ? inArray(discountRequest.leadId, leadIds) : undefined,
          visibleLeads(ctx),
        ),
      )
      .groupBy(discountRequest.leadId, discountRequest.unitId),
  );
}

export type ApprovedDiscount = Awaited<ReturnType<typeof listApprovedDiscounts>>[number];

/** Pending requests to decide (dashboard to-do). */
export async function countPendingDiscountRequests(tx: Tx) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(discountRequest)
    .where(eq(discountRequest.status, "pending"));
  return row?.n ?? 0;
}
