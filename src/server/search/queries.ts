import "server-only";

import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";

import { buyer, lead, project, reservation, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { can } from "@/lib/permissions";
import type { TenantCtx } from "@/server/auth/session";
import { visibleBuyers } from "@/server/buyers/access";
import { searchCondition as buyerSearch } from "@/server/buyers/queries";
import { listConditions as leadConditions } from "@/server/crm/queries";
import { visibleSales } from "@/server/sales/access";
import { buyerNames, searchCondition as saleSearch } from "@/server/sales/sale-queries";

/** How many records of each kind the command palette shows. */
export const SEARCH_LIMIT = 5;

export type SearchHit = {
  kind: "lead" | "buyer" | "sale" | "unit";
  id: string;
  href: string;
  title: string;
  detail: string | null;
};

/**
 * The command palette's records (CLAUDE.md §14 item 8): leads, buyers, sales and units matching
 * a name, a phone, a NIN, a number or a code — through the same conditions and visibility as
 * their lists, each kind only for members who may read it.
 */
export async function searchRecords(ctx: TenantCtx, q: string): Promise<SearchHit[]> {
  return withTenant(ctx, async (tx) => {
    const hits: SearchHit[] = [];
    if (can(ctx, "lead:read")) {
      const rows = await tx
        .select({ id: lead.id, name: lead.fullName, phone: lead.phone })
        .from(lead)
        .where(leadConditions(ctx, { q }))
        .orderBy(desc(lead.updatedAt))
        .limit(SEARCH_LIMIT);
      for (const r of rows) {
        hits.push({
          kind: "lead",
          id: r.id,
          href: `/leads/${r.id}`,
          title: r.name,
          detail: r.phone,
        });
      }
    }
    if (can(ctx, "buyer:read")) {
      const rows = await tx
        .select({
          id: buyer.id,
          lastName: buyer.lastName,
          firstName: buyer.firstName,
          phone: buyer.phone,
        })
        .from(buyer)
        .where(and(isNull(buyer.deletedAt), visibleBuyers(ctx), buyerSearch(q)))
        .orderBy(asc(buyer.lastName), asc(buyer.firstName))
        .limit(SEARCH_LIMIT);
      for (const r of rows) {
        hits.push({
          kind: "buyer",
          id: r.id,
          href: `/buyers/${r.id}`,
          title: `${r.lastName} ${r.firstName}`,
          detail: r.phone,
        });
      }
    }
    if (can(ctx, "sale:read")) {
      const rows = await tx
        .select({ id: reservation.id, number: reservation.number, unitCode: unit.code })
        .from(reservation)
        .innerJoin(unit, eq(unit.id, reservation.unitId))
        .where(and(visibleSales(ctx), saleSearch(q)))
        .orderBy(desc(reservation.reservedOn), desc(reservation.number))
        .limit(SEARCH_LIMIT);
      const names = await buyerNames(
        tx,
        rows.map((r) => r.id),
      );
      for (const r of rows) {
        hits.push({
          kind: "sale",
          id: r.id,
          href: `/sales/${r.id}`,
          title: `${r.number} · ${r.unitCode}`,
          detail: names.get(r.id) ?? null,
        });
      }
    }
    if (can(ctx, "inventory:read")) {
      const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
      const rows = await tx
        .select({
          id: unit.id,
          code: unit.code,
          projectId: unit.projectId,
          projectName: project.name,
        })
        .from(unit)
        .innerJoin(project, eq(project.id, unit.projectId))
        .where(and(isNull(unit.deletedAt), isNull(project.deletedAt), ilike(unit.code, like)))
        .orderBy(asc(project.name), asc(unit.code))
        .limit(SEARCH_LIMIT);
      for (const r of rows) {
        hits.push({
          kind: "unit",
          id: r.id,
          href: `/projects/${r.projectId}/units/${r.id}`,
          title: r.code,
          detail: r.projectName,
        });
      }
    }
    return hits;
  });
}
