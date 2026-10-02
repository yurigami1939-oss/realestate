import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { commission, commissionRate, member, project, reservation, unit, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { can, parseRoles } from "@/lib/permissions";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadSalesSettings } from "@/server/organizations/settings";

import { COMMISSIONS_PAGE_SIZE, type CommissionListParams } from "./schemas";

/**
 * Commissions (CLAUDE.md §12: % of the net price, earned at the VSP), most recent first,
 * with the amounts still to pay and already paid. A commercial sees their own.
 */
export async function listCommissions(ctx: TenantCtx, params: CommissionListParams) {
  assertCan(ctx, "commission:read");
  const page = params.page ?? 1;
  const seesAll = can(ctx.roles, "commission:read_all");
  const scope = seesAll
    ? params.userId
      ? eq(commission.userId, params.userId)
      : undefined
    : eq(commission.userId, ctx.userId);
  return withTenant(ctx, async (tx) => {
    const where = and(scope, params.status ? eq(commission.status, params.status) : undefined);
    const rows = await tx
      .select({
        id: commission.id,
        reservationId: commission.reservationId,
        saleNumber: reservation.saleNumber,
        reservationNumber: reservation.number,
        unitCode: unit.code,
        projectName: project.name,
        userId: commission.userId,
        commercialName: user.name,
        base: commission.base,
        rateBp: commission.rateBp,
        amount: commission.amount,
        earnedOn: commission.earnedOn,
        status: commission.status,
        paidOn: commission.paidOn,
      })
      .from(commission)
      .innerJoin(reservation, eq(reservation.id, commission.reservationId))
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .innerJoin(user, eq(user.id, commission.userId))
      .where(where)
      .orderBy(desc(commission.earnedOn), desc(commission.createdAt))
      .limit(COMMISSIONS_PAGE_SIZE)
      .offset((page - 1) * COMMISSIONS_PAGE_SIZE);
    const [totals] = await tx
      .select({
        n: sql<number>`count(*) filter (where ${where ?? sql`true`})::int`,
        earned: sql<string>`coalesce(sum(${commission.amount}) filter (where ${commission.status} = 'earned'), 0)::text`,
        paid: sql<string>`coalesce(sum(${commission.amount}) filter (where ${commission.status} = 'paid'), 0)::text`,
      })
      .from(commission)
      .where(scope);
    return {
      rows,
      total: totals?.n ?? 0,
      earned: BigInt(totals?.earned ?? "0"),
      paid: BigInt(totals?.paid ?? "0"),
      page,
      pageSize: COMMISSIONS_PAGE_SIZE,
    };
  });
}

export type CommissionRow = Awaited<ReturnType<typeof listCommissions>>["rows"][number];

/** Commercials (members who own leads) for the commission filter. */
export async function listCommissionEarners(ctx: TenantCtx) {
  assertCan(ctx, "commission:read_all");
  return withTenant(ctx, async (tx) => {
    // `member` is scoped by Better Auth, not RLS: filter on the organization explicitly.
    const members = await tx
      .select({ userId: member.userId, role: member.role, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ctx.orgId))
      .orderBy(user.name);
    return members
      .filter((m) => can(parseRoles(m.role), "lead:read"))
      .map(({ userId, name }) => ({ userId, name }));
  });
}

/** Company default and per-commercial commission rates (gérant). */
export async function getCommissionRates(ctx: TenantCtx) {
  assertCan(ctx, "organization:update");
  const earners = await listCommissionEarners(ctx);
  return withTenant(ctx, async (tx) => {
    const settings = await loadSalesSettings(tx, ctx.orgId);
    const rates = await tx
      .select({ userId: commissionRate.userId, rateBp: commissionRate.rateBp })
      .from(commissionRate);
    return {
      defaultRateBp: settings.defaultCommissionRateBp,
      rows: earners.map((e) => ({
        ...e,
        rateBp: rates.find((r) => r.userId === e.userId)?.rateBp ?? null,
      })),
    };
  });
}

export type CommissionRates = Awaited<ReturnType<typeof getCommissionRates>>;
