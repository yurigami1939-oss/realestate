import "server-only";

import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import type { z } from "zod";

import { member, quotation, reservation, salesTarget, user, visit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addMonths, fromAlgiersDateTime } from "@/lib/dates";
import { can, parseRoles } from "@/lib/permissions";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { assertLeadOwner, seesAllLeads } from "./access";
import type { saveTargetsSchema } from "./schemas";

/** Instants bounding an Algiers calendar month "YYYY-MM". */
export function monthRange(month: string) {
  const [year = 0, m = 1] = month.split("-").map(Number);
  const next = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
  const from = fromAlgiersDateTime(`${month}-01T00:00`);
  const to = fromAlgiersDateTime(`${next}-01T00:00`);
  if (!from || !to) throw new RangeError(`monthRange: invalid month "${month}"`);
  return { from, to, firstDay: `${month}-01` };
}

/** Managers set each commercial's monthly targets (visits done, quotations issued). */
export async function saveTargets(ctx: TenantCtx, input: z.output<typeof saveTargetsSchema>) {
  assertCan(ctx, "target:update");
  const { firstDay } = monthRange(input.month);
  await withTenant(ctx, async (tx) => {
    for (const [index, target] of input.targets.entries()) {
      await assertLeadOwner(tx, ctx.orgId, target.userId, `targets.${index}.userId`);
      await tx
        .insert(salesTarget)
        .values({
          organizationId: ctx.orgId,
          userId: target.userId,
          month: firstDay,
          visits: target.visits,
          quotations: target.quotations,
          reservations: target.reservations,
          sales: target.sales,
          updatedBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [salesTarget.organizationId, salesTarget.userId, salesTarget.month],
          set: {
            visits: target.visits,
            quotations: target.quotations,
            reservations: target.reservations,
            sales: target.sales,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          },
        });
    }
  });
}

/**
 * Targets and achievements of a month: visits done (by date of the visit), quotations issued
 * and not cancelled, reservations signed (not withdrawn) and VSP signed, credited to the
 * commercial of the sale. Commercials see their own line, managers everyone's.
 */
export async function getTargetProgress(ctx: TenantCtx, month: string) {
  assertCan(ctx, "lead:read");
  const { from, to, firstDay } = monthRange(month);
  return withTenant(ctx, async (tx) => {
    // `member` is scoped by Better Auth, not RLS: filter on the organization explicitly.
    const members = await tx
      .select({ userId: member.userId, role: member.role, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ctx.orgId))
      .orderBy(user.name);
    const people = members.filter(
      (m) => can(parseRoles(m.role), "lead:read") && (seesAllLeads(ctx) || m.userId === ctx.userId),
    );

    const targets = await tx.select().from(salesTarget).where(eq(salesTarget.month, firstDay));
    const visits = await tx
      .select({ userId: visit.agentUserId, n: sql<number>`count(*)::int` })
      .from(visit)
      .where(and(eq(visit.status, "done"), gte(visit.scheduledAt, from), lt(visit.scheduledAt, to)))
      .groupBy(visit.agentUserId);
    const quotations = await tx
      .select({ userId: quotation.issuedBy, n: sql<number>`count(*)::int` })
      .from(quotation)
      .where(
        and(
          eq(quotation.status, "issued"),
          gte(quotation.issuedAt, from),
          lt(quotation.issuedAt, to),
        ),
      )
      .groupBy(quotation.issuedBy);
    const nextMonth = addMonths(firstDay, 1);
    const reservations = await tx
      .select({ userId: reservation.commercialUserId, n: sql<number>`count(*)::int` })
      .from(reservation)
      .where(
        and(
          ne(reservation.status, "withdrawn"),
          gte(reservation.reservedOn, firstDay),
          lt(reservation.reservedOn, nextMonth),
        ),
      )
      .groupBy(reservation.commercialUserId);
    const sales = await tx
      .select({ userId: reservation.commercialUserId, n: sql<number>`count(*)::int` })
      .from(reservation)
      .where(
        and(
          eq(reservation.status, "sold"),
          gte(reservation.saleSignedOn, firstDay),
          lt(reservation.saleSignedOn, nextMonth),
        ),
      )
      .groupBy(reservation.commercialUserId);
    const count = (rows: { userId: string | null; n: number }[], userId: string) =>
      rows.find((r) => r.userId === userId)?.n ?? 0;

    return people.map((p) => {
      const target = targets.find((t) => t.userId === p.userId);
      return {
        userId: p.userId,
        name: p.name,
        target: {
          visits: target?.visits ?? 0,
          quotations: target?.quotations ?? 0,
          reservations: target?.reservations ?? 0,
          sales: target?.sales ?? 0,
        },
        actual: {
          visits: count(visits, p.userId),
          quotations: count(quotations, p.userId),
          reservations: count(reservations, p.userId),
          sales: count(sales, p.userId),
        },
      };
    });
  });
}

export type TargetProgress = Awaited<ReturnType<typeof getTargetProgress>>[number];
