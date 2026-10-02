import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { building, project, residence, residenceUnit, resident, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { currentResident } from "./service";

/** Residences with their units, tantièmes and how many units have a current co-owner. */
export async function listResidences(ctx: TenantCtx) {
  assertCan(ctx, "residence:read");
  const today = todayInAlgiers();
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: residence.id,
        name: residence.name,
        projectName: project.name,
        shareBasis: residence.shareBasis,
        chargeFrequency: residence.chargeFrequency,
        units: sql<number>`(select count(*)::int from residence_unit ru
          where ru.residence_id = ${residence.id})`,
        shares: sql<number>`(select coalesce(sum(ru.share), 0)::int from residence_unit ru
          where ru.residence_id = ${residence.id})`,
        unitsWithCoOwner: sql<number>`(select count(distinct r.unit_id)::int from resident r
          where r.residence_id = ${residence.id} and r.kind = 'co_owner' and r.deleted_at is null
            and (r.since_on is null or r.since_on <= ${today}::date)
            and (r.until_on is null or r.until_on >= ${today}::date))`,
      })
      .from(residence)
      .innerJoin(project, eq(project.id, residence.projectId))
      .where(isNull(residence.deletedAt))
      .orderBy(asc(residence.name)),
  );
}

export type ResidenceListRow = Awaited<ReturnType<typeof listResidences>>[number];

/** Residence sheet: settings, units with tantièmes and their current co-owners / occupants. */
export async function getResidence(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "residence:read");
  if (!isUuid(residenceId)) return null;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ residence, projectName: project.name })
      .from(residence)
      .innerJoin(project, eq(project.id, residence.projectId))
      .where(and(eq(residence.id, residenceId), isNull(residence.deletedAt)));
    if (!row) return null;
    const units = await tx
      .select({
        unitId: unit.id,
        code: unit.code,
        buildingCode: building.code,
        floor: unit.floor,
        type: unit.type,
        typology: unit.typology,
        livingArea: unit.livingArea,
        usableArea: unit.usableArea,
        share: residenceUnit.share,
      })
      .from(residenceUnit)
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .innerJoin(building, eq(building.id, unit.buildingId))
      .where(eq(residenceUnit.residenceId, residenceId))
      .orderBy(asc(unit.code));
    const residents = await tx
      .select({
        id: resident.id,
        unitId: resident.unitId,
        kind: resident.kind,
        isMain: resident.isMain,
        lastName: resident.lastName,
        firstName: resident.firstName,
        phone: resident.phone,
        sinceOn: resident.sinceOn,
      })
      .from(resident)
      .where(and(eq(resident.residenceId, residenceId), currentResident(today)))
      .orderBy(asc(resident.kind), desc(resident.isMain), asc(resident.lastName));
    return {
      ...row.residence,
      projectName: row.projectName,
      units: units.map((u) => ({
        ...u,
        residents: residents.filter((r) => r.unitId === u.unitId),
      })),
      totalShares: units.reduce((sum, u) => sum + u.share, 0),
    };
  });
}

export type ResidenceDetail = NonNullable<Awaited<ReturnType<typeof getResidence>>>;

/** Every co-owner and occupant a unit has had in the residence, current first. */
export async function listUnitResidents(ctx: TenantCtx, residenceId: string, unitIds: string[]) {
  assertCan(ctx, "residence:read");
  if (!isUuid(residenceId) || unitIds.length === 0) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: resident.id,
        unitId: resident.unitId,
        kind: resident.kind,
        isMain: resident.isMain,
        lastName: resident.lastName,
        firstName: resident.firstName,
        lastNameAr: resident.lastNameAr,
        firstNameAr: resident.firstNameAr,
        phone: resident.phone,
        email: resident.email,
        sinceOn: resident.sinceOn,
        untilOn: resident.untilOn,
        fromSale: sql<boolean>`${resident.buyerId} is not null`,
      })
      .from(resident)
      .where(
        and(
          eq(resident.residenceId, residenceId),
          inArray(resident.unitId, unitIds),
          isNull(resident.deletedAt),
        ),
      )
      .orderBy(sql`${resident.untilOn} is not null`, desc(resident.isMain), asc(resident.lastName)),
  );
}

export type UnitResident = Awaited<ReturnType<typeof listUnitResidents>>[number];
