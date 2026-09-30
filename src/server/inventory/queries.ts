import "server-only";

import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";

import {
  building,
  file,
  priceList,
  priceListItem,
  project,
  unit,
  unitPriceHistory,
  unitStatusHistory,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/session";

/** Unit counts by commercial state, computed over live units joined as `unit`. */
const unitStats = {
  units: sql<number>`count(${unit.id})`.mapWith(Number),
  available: sql<number>`count(${unit.id}) filter (where ${unit.status} = 'available')`.mapWith(
    Number,
  ),
  engaged:
    sql<number>`count(${unit.id}) filter (where ${unit.status} in ('optioned', 'reserved'))`.mapWith(
      Number,
    ),
  sold: sql<number>`count(${unit.id}) filter (where ${unit.status} in ('sold', 'delivered'))`.mapWith(
    Number,
  ),
  unavailable:
    sql<number>`count(${unit.id}) filter (where ${unit.status} in ('blocked', 'rented'))`.mapWith(
      Number,
    ),
};

export type UnitStats = {
  units: number;
  available: number;
  engaged: number;
  sold: number;
  unavailable: number;
};

export async function listProjects(ctx: TenantCtx) {
  assertCan(ctx, "inventory:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
        wilaya: project.wilaya,
        commune: project.commune,
        plannedDeliveryOn: project.plannedDeliveryOn,
        ...unitStats,
      })
      .from(project)
      .leftJoin(unit, and(eq(unit.projectId, project.id), isNull(unit.deletedAt)))
      .where(isNull(project.deletedAt))
      .groupBy(project.id)
      .orderBy(asc(project.name)),
  );
}

export type ProjectListItem = Awaited<ReturnType<typeof listProjects>>[number];

export async function getProject(ctx: TenantCtx, projectId: string) {
  assertCan(ctx, "inventory:read");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), isNull(project.deletedAt)));
    if (!row) return null;

    const buildings = await tx
      .select({
        id: building.id,
        code: building.code,
        name: building.name,
        lowestFloor: building.lowestFloor,
        topFloor: building.topFloor,
        ...unitStats,
      })
      .from(building)
      .leftJoin(unit, and(eq(unit.buildingId, building.id), isNull(unit.deletedAt)))
      .where(and(eq(building.projectId, projectId), isNull(building.deletedAt)))
      .groupBy(building.id)
      .orderBy(asc(building.code));

    const totals = buildings.reduce<UnitStats>(
      (acc, b) => ({
        units: acc.units + b.units,
        available: acc.available + b.available,
        engaged: acc.engaged + b.engaged,
        sold: acc.sold + b.sold,
        unavailable: acc.unavailable + b.unavailable,
      }),
      { units: 0, available: 0, engaged: 0, sold: 0, unavailable: 0 },
    );

    return { ...row, buildings, totals };
  });
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProject>>>;

/** Buildings of a project (for selects). */
export async function listBuildings(ctx: TenantCtx, projectId: string) {
  assertCan(ctx, "inventory:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: building.id,
        code: building.code,
        name: building.name,
        lowestFloor: building.lowestFloor,
        topFloor: building.topFloor,
      })
      .from(building)
      .where(and(eq(building.projectId, projectId), isNull(building.deletedAt)))
      .orderBy(asc(building.code)),
  );
}

/** A building with its live units, top floor first (availability grid). */
export async function getBuildingGrid(ctx: TenantCtx, buildingId: string) {
  assertCan(ctx, "inventory:read");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: building.id,
        code: building.code,
        name: building.name,
        lowestFloor: building.lowestFloor,
        topFloor: building.topFloor,
        projectId: project.id,
        projectCode: project.code,
        projectName: project.name,
      })
      .from(building)
      .innerJoin(project, eq(project.id, building.projectId))
      .where(and(eq(building.id, buildingId), isNull(building.deletedAt)));
    if (!row) return null;

    const units = await tx
      .select({
        id: unit.id,
        code: unit.code,
        floor: unit.floor,
        type: unit.type,
        typology: unit.typology,
        isDuplex: unit.isDuplex,
        livingArea: unit.livingArea,
        listPrice: unit.listPrice,
        status: unit.status,
      })
      .from(unit)
      .where(and(eq(unit.buildingId, buildingId), isNull(unit.deletedAt)))
      .orderBy(desc(unit.floor), asc(unit.code));

    return { ...row, units };
  });
}

export type BuildingGrid = NonNullable<Awaited<ReturnType<typeof getBuildingGrid>>>;
export type GridUnit = BuildingGrid["units"][number];

/** Unit sheet with its status and price histories. */
export async function getUnit(ctx: TenantCtx, unitId: string) {
  assertCan(ctx, "inventory:read");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        unit,
        buildingCode: building.code,
        buildingName: building.name,
        projectCode: project.code,
        projectName: project.name,
      })
      .from(unit)
      .innerJoin(building, eq(building.id, unit.buildingId))
      .innerJoin(project, eq(project.id, unit.projectId))
      .where(and(eq(unit.id, unitId), isNull(unit.deletedAt)));
    if (!row) return null;

    const [statusHistory, priceHistory, floorPlan] = await Promise.all([
      tx
        .select({
          id: unitStatusHistory.id,
          fromStatus: unitStatusHistory.fromStatus,
          toStatus: unitStatusHistory.toStatus,
          reason: unitStatusHistory.reason,
          createdAt: unitStatusHistory.createdAt,
          actorName: user.name,
        })
        .from(unitStatusHistory)
        .leftJoin(user, eq(user.id, unitStatusHistory.actorUserId))
        .where(eq(unitStatusHistory.unitId, unitId))
        .orderBy(desc(unitStatusHistory.createdAt)),
      tx
        .select({
          id: unitPriceHistory.id,
          oldPrice: unitPriceHistory.oldPrice,
          newPrice: unitPriceHistory.newPrice,
          reason: unitPriceHistory.reason,
          createdAt: unitPriceHistory.createdAt,
          actorName: user.name,
          priceListVersion: priceList.version,
        })
        .from(unitPriceHistory)
        .leftJoin(user, eq(user.id, unitPriceHistory.actorUserId))
        .leftJoin(priceList, eq(priceList.id, unitPriceHistory.priceListId))
        .where(eq(unitPriceHistory.unitId, unitId))
        .orderBy(desc(unitPriceHistory.createdAt)),
      row.unit.floorPlanFileId
        ? tx
            .select({
              id: file.id,
              fileName: file.fileName,
              contentType: file.contentType,
              sizeBytes: file.sizeBytes,
            })
            .from(file)
            .where(and(eq(file.id, row.unit.floorPlanFileId), isNull(file.deletedAt)))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    return {
      ...row.unit,
      buildingCode: row.buildingCode,
      buildingName: row.buildingName,
      projectCode: row.projectCode,
      projectName: row.projectName,
      statusHistory,
      priceHistory,
      floorPlan,
    };
  });
}

export type UnitDetail = NonNullable<Awaited<ReturnType<typeof getUnit>>>;

export async function listPriceLists(ctx: TenantCtx, projectId: string) {
  assertCan(ctx, "inventory:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: priceList.id,
        version: priceList.version,
        name: priceList.name,
        status: priceList.status,
        createdAt: priceList.createdAt,
        appliedAt: priceList.appliedAt,
        items: count(priceListItem.unitId),
      })
      .from(priceList)
      .leftJoin(priceListItem, eq(priceListItem.priceListId, priceList.id))
      .where(eq(priceList.projectId, projectId))
      .groupBy(priceList.id)
      .orderBy(desc(priceList.version)),
  );
}

/** A price list with one row per live unit of its project (unpriced units included). */
export async function getPriceList(ctx: TenantCtx, priceListId: string) {
  assertCan(ctx, "inventory:read");
  return withTenant(ctx, async (tx) => {
    const [list] = await tx
      .select({
        id: priceList.id,
        projectId: priceList.projectId,
        version: priceList.version,
        name: priceList.name,
        status: priceList.status,
        appliedAt: priceList.appliedAt,
        createdAt: priceList.createdAt,
        projectCode: project.code,
        projectName: project.name,
      })
      .from(priceList)
      .innerJoin(project, eq(project.id, priceList.projectId))
      .where(eq(priceList.id, priceListId));
    if (!list) return null;

    const rows = await tx
      .select({
        unitId: unit.id,
        code: unit.code,
        buildingCode: building.code,
        floor: unit.floor,
        typology: unit.typology,
        type: unit.type,
        livingArea: unit.livingArea,
        currentPrice: unit.listPrice,
        price: priceListItem.price,
      })
      .from(unit)
      .innerJoin(building, eq(building.id, unit.buildingId))
      .leftJoin(
        priceListItem,
        and(eq(priceListItem.unitId, unit.id), eq(priceListItem.priceListId, priceListId)),
      )
      .where(and(eq(unit.projectId, list.projectId), isNull(unit.deletedAt)))
      .orderBy(asc(building.code), desc(unit.floor), asc(unit.code));

    return { ...list, rows };
  });
}

export type PriceListDetail = NonNullable<Awaited<ReturnType<typeof getPriceList>>>;
