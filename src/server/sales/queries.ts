import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { lead, project, unit, unitOption, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import type { Typology, UnitStatus, UnitType } from "@/lib/inventory";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { visibleLeads } from "@/server/crm/access";

const placer = alias(user, "placer");

/** An active option still counts until the job ends it; past its expiry it shows as expired. */
const optionState = sql<"active" | "expired" | "cancelled" | "converted">`case
  when ${unitOption.status} = 'active' and ${unitOption.expiresAt} <= now() then 'expired'
  else ${unitOption.status}::text end`;

/**
 * The active option on a unit, if any. The holder's name is only given to members who see
 * the lead (a commercial does not learn another commercial's prospects).
 */
export async function getUnitOption(ctx: TenantCtx, unitId: string) {
  assertCan(ctx, "inventory:read");
  if (!isUuid(unitId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: unitOption.id,
        leadId: unitOption.leadId,
        expiresAt: unitOption.expiresAt,
        placedAt: unitOption.placedAt,
        placedByName: placer.name,
      })
      .from(unitOption)
      .leftJoin(placer, eq(placer.id, unitOption.placedBy))
      .where(and(eq(unitOption.unitId, unitId), eq(unitOption.status, "active")));
    if (!row) return null;
    const [visible] = await tx
      .select({ name: lead.fullName })
      .from(lead)
      .where(and(eq(lead.id, row.leadId), visibleLeads(ctx)));
    return { ...row, leadName: visible?.name ?? null, leadVisible: visible !== undefined };
  });
}

export type UnitOptionInfo = NonNullable<Awaited<ReturnType<typeof getUnitOption>>>;

/** Options of a lead, most recent first, with the derived state. */
export async function listLeadOptions(ctx: TenantCtx, leadId: string) {
  assertCan(ctx, "lead:read");
  if (!isUuid(leadId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: unitOption.id,
        unitId: unitOption.unitId,
        unitCode: unit.code,
        projectId: unit.projectId,
        projectName: project.name,
        expiresAt: unitOption.expiresAt,
        placedAt: unitOption.placedAt,
        state: optionState,
      })
      .from(unitOption)
      .innerJoin(lead, eq(lead.id, unitOption.leadId))
      .innerJoin(unit, eq(unit.id, unitOption.unitId))
      .innerJoin(project, eq(project.id, unit.projectId))
      .where(and(eq(unitOption.leadId, leadId), visibleLeads(ctx)))
      .orderBy(desc(unitOption.placedAt)),
  );
}

export type LeadOptionRow = Awaited<ReturnType<typeof listLeadOptions>>[number];

export type ReservableUnit = {
  id: string;
  code: string;
  type: UnitType;
  typology: Typology | null;
  status: UnitStatus;
  listPrice: bigint;
  projectId: string;
  projectName: string;
  /** The active option, for an optioned unit (only that lead's buyers can reserve it). */
  option: { unitId: string; leadId: string; leadName: string } | null;
};

/**
 * Units a member may reserve: available ones, and optioned ones whose option belongs to a
 * lead they see (only that lead's buyers can reserve it).
 */
export async function listReservableUnits(ctx: TenantCtx): Promise<ReservableUnit[]> {
  assertCan(ctx, "sale:create");
  return withTenant(ctx, async (tx) => {
    const units = await tx
      .select({
        id: unit.id,
        code: unit.code,
        type: unit.type,
        typology: unit.typology,
        status: unit.status,
        listPrice: unit.listPrice,
        projectId: unit.projectId,
        projectName: project.name,
      })
      .from(unit)
      .innerJoin(project, eq(project.id, unit.projectId))
      .where(and(sql`${unit.deletedAt} is null`, inArray(unit.status, ["available", "optioned"])))
      .orderBy(asc(project.name), asc(unit.code));
    const options = await tx
      .select({ unitId: unitOption.unitId, leadId: unitOption.leadId, leadName: lead.fullName })
      .from(unitOption)
      .innerJoin(lead, eq(lead.id, unitOption.leadId))
      .where(and(eq(unitOption.status, "active"), visibleLeads(ctx)));
    return units.flatMap((u): ReservableUnit[] => {
      if (u.listPrice === null) return [];
      if (u.status === "available") return [{ ...u, listPrice: u.listPrice, option: null }];
      const option = options.find((o) => o.unitId === u.id);
      return option ? [{ ...u, listPrice: u.listPrice, option }] : [];
    });
  });
}
