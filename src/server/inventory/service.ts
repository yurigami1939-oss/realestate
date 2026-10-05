import "server-only";

import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { building, project, unit, unitPriceHistory, unitStatusHistory } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { defaultUnitCode } from "@/lib/inventory";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type {
  createBuildingSchema,
  createProjectSchema,
  createUnitSchema,
  deleteBuildingSchema,
  deleteProjectSchema,
  deleteUnitSchema,
  generateUnitsSchema,
  unitStatusReasonSchema,
  updateBuildingSchema,
  updateProjectSchema,
  updateUnitPriceSchema,
  updateUnitSchema,
} from "./schemas";
import { transitionUnit } from "./transition-unit";

type In<S extends z.ZodType> = z.output<S>;

const codeTaken = () => new AppError("CONFLICT", "inventory.errors.codeTaken");

/** Runs a write and turns a unique-code violation into a CONFLICT. */
async function uniqueCode<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw codeTaken();
    throw error;
  }
}

async function getLiveBuilding(tx: Tx, buildingId: string) {
  const [row] = await tx
    .select()
    .from(building)
    .where(and(eq(building.id, buildingId), isNull(building.deletedAt)));
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

function assertFloorInBuilding(floor: number, b: { lowestFloor: number; topFloor: number }) {
  if (floor < b.lowestFloor || floor > b.topFloor) {
    throw new AppError("VALIDATION", "errors.VALIDATION", {
      fieldErrors: { floor: ["inventory.errors.floorOutOfRange"] },
    });
  }
}

async function liveUnitCount(tx: Tx, where: ReturnType<typeof eq>) {
  const [row] = await tx
    .select({ n: count() })
    .from(unit)
    .where(and(where, isNull(unit.deletedAt)));
  return row?.n ?? 0;
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function createProject(ctx: TenantCtx, input: In<typeof createProjectSchema>) {
  assertCan(ctx, "project:create");
  return withTenant(ctx, (tx) =>
    uniqueCode(async () => {
      const [row] = await tx
        .insert(project)
        .values({ ...input, organizationId: ctx.orgId, createdBy: ctx.userId })
        .returning({ id: project.id });
      if (!row) throw new AppError("UNEXPECTED");
      return row;
    }),
  );
}

export async function updateProject(ctx: TenantCtx, input: In<typeof updateProjectSchema>) {
  assertCan(ctx, "project:update");
  const { projectId, ...values } = input;
  await withTenant(ctx, (tx) =>
    uniqueCode(async () => {
      const updated = await tx
        .update(project)
        .set(values)
        .where(and(eq(project.id, projectId), isNull(project.deletedAt)))
        .returning({ id: project.id });
      if (updated.length === 0) throw new AppError("NOT_FOUND");
    }),
  );
}

/** Soft delete; only an empty project (no units) can be deleted. */
export async function deleteProject(ctx: TenantCtx, input: In<typeof deleteProjectSchema>) {
  assertCan(ctx, "project:delete");
  await withTenant(ctx, async (tx) => {
    if ((await liveUnitCount(tx, eq(unit.projectId, input.projectId))) > 0) {
      throw new AppError("CONFLICT", "inventory.errors.projectHasUnits");
    }
    const now = new Date();
    const deleted = await tx
      .update(project)
      .set({ deletedAt: now, deletedBy: ctx.userId })
      .where(and(eq(project.id, input.projectId), isNull(project.deletedAt)))
      .returning({ id: project.id });
    if (deleted.length === 0) throw new AppError("NOT_FOUND");
    await tx
      .update(building)
      .set({ deletedAt: now, deletedBy: ctx.userId })
      .where(and(eq(building.projectId, input.projectId), isNull(building.deletedAt)));
  });
}

// ── Buildings ───────────────────────────────────────────────────────────────

export async function createBuilding(ctx: TenantCtx, input: In<typeof createBuildingSchema>) {
  assertCan(ctx, "project:update");
  return withTenant(ctx, async (tx) => {
    const [parent] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, input.projectId), isNull(project.deletedAt)));
    if (!parent) throw new AppError("NOT_FOUND");
    return uniqueCode(async () => {
      const [row] = await tx
        .insert(building)
        .values({ ...input, organizationId: ctx.orgId, createdBy: ctx.userId })
        .returning({ id: building.id });
      if (!row) throw new AppError("UNEXPECTED");
      return row;
    });
  });
}

export async function updateBuilding(ctx: TenantCtx, input: In<typeof updateBuildingSchema>) {
  assertCan(ctx, "project:update");
  const { buildingId, ...values } = input;
  await withTenant(ctx, async (tx) => {
    await getLiveBuilding(tx, buildingId);
    // Shrinking the floor range must not strand existing units.
    const units = await tx
      .select({ floor: unit.floor })
      .from(unit)
      .where(and(eq(unit.buildingId, buildingId), isNull(unit.deletedAt)));
    if (units.some((u) => u.floor < values.lowestFloor || u.floor > values.topFloor)) {
      throw new AppError("VALIDATION", "errors.VALIDATION", {
        fieldErrors: { topFloor: ["inventory.errors.unitsOutsideFloors"] },
      });
    }
    await uniqueCode(() => tx.update(building).set(values).where(eq(building.id, buildingId)));
  });
}

/** Soft delete; only an empty building can be deleted. */
export async function deleteBuilding(ctx: TenantCtx, input: In<typeof deleteBuildingSchema>) {
  assertCan(ctx, "project:update");
  await withTenant(ctx, async (tx) => {
    await getLiveBuilding(tx, input.buildingId);
    if ((await liveUnitCount(tx, eq(unit.buildingId, input.buildingId))) > 0) {
      throw new AppError("CONFLICT", "inventory.errors.buildingHasUnits");
    }
    await tx
      .update(building)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(building.id, input.buildingId));
  });
}

// ── Units ───────────────────────────────────────────────────────────────────

export async function createUnit(ctx: TenantCtx, input: In<typeof createUnitSchema>, outer?: Tx) {
  assertCan(ctx, "unit:create");
  return withTenant(
    ctx,
    async (tx) => {
      const parent = await getLiveBuilding(tx, input.buildingId);
      assertFloorInBuilding(input.floor, parent);
      const created = await uniqueCode(async () => {
        const [row] = await tx
          .insert(unit)
          .values({
            ...input,
            organizationId: ctx.orgId,
            projectId: parent.projectId,
            createdBy: ctx.userId,
          })
          .returning({ id: unit.id });
        if (!row) throw new AppError("UNEXPECTED");
        return row;
      });
      await tx.insert(unitStatusHistory).values({
        organizationId: ctx.orgId,
        unitId: created.id,
        fromStatus: null,
        toStatus: "available",
        actorUserId: ctx.userId,
      });
      return created;
    },
    outer,
  );
}

/** Edits the unit sheet. Status and price have their own audited paths. */
export async function updateUnit(ctx: TenantCtx, input: In<typeof updateUnitSchema>) {
  assertCan(ctx, "unit:update");
  const { unitId, ...values } = input;
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ projectId: unit.projectId })
      .from(unit)
      .where(and(eq(unit.id, unitId), isNull(unit.deletedAt)));
    if (!current) throw new AppError("NOT_FOUND");
    const target = await getLiveBuilding(tx, values.buildingId);
    if (target.projectId !== current.projectId) throw new AppError("NOT_FOUND");
    assertFloorInBuilding(values.floor, target);
    await uniqueCode(() => tx.update(unit).set(values).where(eq(unit.id, unitId)));
  });
}

/** Soft delete of a unit that was never engaged in a sale (available or blocked only). */
export async function deleteUnit(ctx: TenantCtx, input: In<typeof deleteUnitSchema>) {
  assertCan(ctx, "unit:delete");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ status: unit.status })
      .from(unit)
      .where(and(eq(unit.id, input.unitId), isNull(unit.deletedAt)))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    if (current.status !== "available" && current.status !== "blocked") {
      throw new AppError("CONFLICT", "inventory.errors.unitNotDeletable");
    }
    await tx
      .update(unit)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(unit.id, input.unitId));
  });
}

/**
 * Creates `unitsPerFloor` units on every floor of the range with default codes
 * (`A-03-02`). Codes that already exist are skipped, so it can be re-run safely.
 */
export async function generateUnits(ctx: TenantCtx, input: In<typeof generateUnitsSchema>) {
  assertCan(ctx, "unit:create");
  return withTenant(ctx, async (tx) => {
    const parent = await getLiveBuilding(tx, input.buildingId);
    assertFloorInBuilding(input.fromFloor, parent);
    assertFloorInBuilding(input.toFloor, parent);

    const planned: { code: string; floor: number }[] = [];
    for (let floor = input.fromFloor; floor <= input.toFloor; floor += 1) {
      for (let position = 1; position <= input.unitsPerFloor; position += 1) {
        planned.push({ code: defaultUnitCode(parent.code, floor, position), floor });
      }
    }

    const existing = await tx
      .select({ code: unit.code })
      .from(unit)
      .where(
        and(
          eq(unit.projectId, parent.projectId),
          isNull(unit.deletedAt),
          inArray(
            unit.code,
            planned.map((p) => p.code),
          ),
        ),
      );
    const taken = new Set(existing.map((e) => e.code));
    const toCreate = planned.filter((p) => !taken.has(p.code));

    if (toCreate.length > 0) {
      const rows = await tx
        .insert(unit)
        .values(
          toCreate.map((p) => ({
            organizationId: ctx.orgId,
            projectId: parent.projectId,
            buildingId: parent.id,
            code: p.code,
            floor: p.floor,
            type: input.type,
            typology: input.typology,
            livingArea: input.livingArea,
            createdBy: ctx.userId,
          })),
        )
        .returning({ id: unit.id });
      await tx.insert(unitStatusHistory).values(
        rows.map((r) => ({
          organizationId: ctx.orgId,
          unitId: r.id,
          fromStatus: null,
          toStatus: "available" as const,
          actorUserId: ctx.userId,
        })),
      );
    }
    return { created: toCreate.length, skipped: planned.length - toCreate.length };
  });
}

export async function blockUnit(
  ctx: TenantCtx,
  input: In<typeof unitStatusReasonSchema>,
  outer?: Tx,
) {
  assertCan(ctx, "unit:block");
  await withTenant(
    ctx,
    (tx) => transitionUnit(tx, ctx, input.unitId, "blocked", { reason: input.reason }),
    outer,
  );
}

export async function unblockUnit(ctx: TenantCtx, input: In<typeof unitStatusReasonSchema>) {
  assertCan(ctx, "unit:block");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ status: unit.status })
      .from(unit)
      .where(eq(unit.id, input.unitId));
    // Unblocking only undoes a block; other statuses leave through their own business flows.
    if (current && current.status !== "blocked") {
      throw new AppError("INVALID_TRANSITION", "errors.INVALID_TRANSITION", {
        details: { from: current.status, to: "available" },
      });
    }
    await transitionUnit(tx, ctx, input.unitId, "available", { reason: input.reason });
  });
}

/** One-off list-price change (price lists change many units at once). Audited. */
export async function updateUnitPrice(
  ctx: TenantCtx,
  input: In<typeof updateUnitPriceSchema>,
  outer?: Tx,
) {
  assertCan(ctx, "price:update");
  await withTenant(
    ctx,
    async (tx) => {
      const [current] = await tx
        .select({ listPrice: unit.listPrice })
        .from(unit)
        .where(and(eq(unit.id, input.unitId), isNull(unit.deletedAt)))
        .for("update");
      if (!current) throw new AppError("NOT_FOUND");
      if (current.listPrice === input.price) return;

      await tx.update(unit).set({ listPrice: input.price }).where(eq(unit.id, input.unitId));
      await tx.insert(unitPriceHistory).values({
        organizationId: ctx.orgId,
        unitId: input.unitId,
        oldPrice: current.listPrice,
        newPrice: input.price,
        reason: input.reason,
        actorUserId: ctx.userId,
      });
      await recordAudit(tx, ctx, {
        actorUserId: ctx.userId,
        action: "unit.price_change",
        entityType: "unit",
        entityId: input.unitId,
        before: { listPrice: current.listPrice },
        after: { listPrice: input.price },
        reason: input.reason,
      });
    },
    outer,
  );
}
