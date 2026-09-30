import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  building,
  project,
  unit,
  unitPriceHistory,
  unitStatusHistory,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { TenantCtx } from "@/server/auth/session";

import { createTenantCtx } from "../../../tests/factories";

import { getBuildingGrid, getUnit, listProjects } from "./queries";
import {
  createBuildingSchema,
  createProjectSchema,
  createUnitSchema,
  generateUnitsSchema,
  unitStatusReasonSchema,
  updateBuildingSchema,
  updateUnitPriceSchema,
} from "./schemas";
import {
  blockUnit,
  createBuilding,
  createProject,
  createUnit,
  deleteBuilding,
  deleteProject,
  deleteUnit,
  generateUnits,
  unblockUnit,
  updateBuilding,
  updateUnitPrice,
} from "./service";
import { transitionUnit } from "./transition-unit";

async function setup(ctx: TenantCtx, code = "OLIV") {
  const { id: projectId } = await createProject(
    ctx,
    createProjectSchema.parse({
      code,
      name: "Résidence Les Oliviers",
      status: "under_construction",
    }),
  );
  const { id: buildingId } = await createBuilding(
    ctx,
    createBuildingSchema.parse({
      projectId,
      code: "a",
      name: "Bloc A",
      lowestFloor: "-1",
      topFloor: "5",
    }),
  );
  return { projectId, buildingId };
}

const unitInput = (buildingId: string, code: string, floor = "2") =>
  createUnitSchema.parse({
    buildingId,
    code,
    floor,
    type: "apartment",
    typology: "F3",
    isDuplex: false,
    livingArea: "85,5",
    orientations: ["S", "E"],
  });

const rows = <T>(ctx: TenantCtx, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ctx, fn);

describe("projects, buildings and units", () => {
  it("scopes codes per project within a tenant, reusable across tenants", async () => {
    const a = await createTenantCtx();
    const b = await createTenantCtx();
    const { buildingId } = await setup(a);
    await setup(b); // same project code in another tenant

    await createUnit(a, unitInput(buildingId, "A-02-01"));
    await expect(createUnit(a, unitInput(buildingId, "a-02-01"))).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "inventory.errors.codeTaken",
    });
    await expect(
      createProject(
        a,
        createProjectSchema.parse({ code: "oliv", name: "Dup", status: "planning" }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps units inside the building's floor range", async () => {
    const ctx = await createTenantCtx();
    const { buildingId } = await setup(ctx);

    await expect(createUnit(ctx, unitInput(buildingId, "A-09-01", "9"))).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { floor: ["inventory.errors.floorOutOfRange"] },
    });
    await createUnit(ctx, unitInput(buildingId, "A-05-01", "5"));
    await expect(
      updateBuilding(
        ctx,
        updateBuildingSchema.parse({
          buildingId,
          code: "A",
          name: "Bloc A",
          lowestFloor: "0",
          topFloor: "4",
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("creates the unit as available with a first status-history row", async () => {
    const ctx = await createTenantCtx();
    const { buildingId } = await setup(ctx);
    const { id } = await createUnit(ctx, unitInput(buildingId, "A-02-01"));

    const detail = await getUnit(ctx, id);
    expect(detail).toMatchObject({
      code: "A-02-01",
      status: "available",
      livingArea: "85.50",
      orientations: ["S", "E"],
      buildingCode: "A",
    });
    expect(detail?.statusHistory).toMatchObject([{ fromStatus: null, toStatus: "available" }]);
  });

  it("generates units with default codes and skips existing ones", async () => {
    const ctx = await createTenantCtx();
    const { buildingId } = await setup(ctx);
    const input = generateUnitsSchema.parse({
      buildingId,
      fromFloor: "0",
      toFloor: "2",
      unitsPerFloor: "4",
      type: "apartment",
      typology: "F3",
      livingArea: "90",
    });

    expect(await generateUnits(ctx, input)).toEqual({ created: 12, skipped: 0 });
    expect(await generateUnits(ctx, input)).toEqual({ created: 0, skipped: 12 });

    const grid = await getBuildingGrid(ctx, buildingId);
    expect(grid?.units.map((u) => u.code).slice(0, 5)).toEqual([
      "A-02-01",
      "A-02-02",
      "A-02-03",
      "A-02-04",
      "A-01-01",
    ]);
    const history = await rows(ctx, (tx) =>
      tx.select().from(unitStatusHistory).where(eq(unitStatusHistory.organizationId, ctx.orgId)),
    );
    expect(history).toHaveLength(12);
  });

  it("refuses a floor range that would create too many units", () => {
    const result = generateUnitsSchema.safeParse({
      buildingId: crypto.randomUUID(),
      fromFloor: "0",
      toFloor: "40",
      unitsPerFloor: "20",
      type: "apartment",
    });
    expect(result.error?.issues[0]?.message).toBe("validation.tooManyUnits");
  });

  it("aggregates unit counts per project", async () => {
    const ctx = await createTenantCtx();
    const { buildingId } = await setup(ctx);
    const { id } = await createUnit(ctx, unitInput(buildingId, "A-01-01", "1"));
    await createUnit(ctx, unitInput(buildingId, "A-01-02", "1"));
    await blockUnit(
      ctx,
      unitStatusReasonSchema.parse({ unitId: id, reason: "Réservé au promoteur" }),
    );

    const [summary] = await listProjects(ctx);
    expect(summary).toMatchObject({
      code: "OLIV",
      units: 2,
      available: 1,
      unavailable: 1,
      sold: 0,
    });
  });
});

describe("unit status", () => {
  it("blocks and unblocks with history and audit", async () => {
    const ctx = await createTenantCtx(["sales_manager"]);
    const owner = { ...ctx, roles: ["owner" as const] };
    const { buildingId } = await setup(owner);
    const { id } = await createUnit(ctx, unitInput(buildingId, "A-02-01"));

    await blockUnit(ctx, unitStatusReasonSchema.parse({ unitId: id, reason: "Logement témoin" }));
    await expect(
      blockUnit(ctx, unitStatusReasonSchema.parse({ unitId: id, reason: "encore" })),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await unblockUnit(
      ctx,
      unitStatusReasonSchema.parse({ unitId: id, reason: "Fin de l'exposition" }),
    );

    const detail = await getUnit(ctx, id);
    expect(detail?.status).toBe("available");
    expect(detail?.statusHistory.map((h) => [h.fromStatus, h.toStatus, h.reason])).toEqual([
      ["blocked", "available", "Fin de l'exposition"],
      ["available", "blocked", "Logement témoin"],
      [null, "available", null],
    ]);
    const audits = await rows(ctx, (tx) =>
      tx
        .select({ action: auditLog.action, actor: auditLog.actorUserId })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, id), eq(auditLog.action, "unit.status_change"))),
    );
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.actor === ctx.userId)).toBe(true);
  });

  it("refuses transitions outside the machine and unblocking a non-blocked unit", async () => {
    const ctx = await createTenantCtx();
    const { buildingId } = await setup(ctx);
    const { id } = await createUnit(ctx, unitInput(buildingId, "A-02-01"));

    await expect(
      withTenant(ctx, (tx) => transitionUnit(tx, ctx, id, "sold")),
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      details: { from: "available", to: "sold" },
    });
    await withTenant(ctx, (tx) =>
      transitionUnit(tx, ctx, id, "reserved", { refType: "reservation" }),
    );
    await expect(
      unblockUnit(ctx, unitStatusReasonSchema.parse({ unitId: id, reason: "x" })),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(deleteUnit(ctx, { unitId: id })).rejects.toMatchObject({
      messageKey: "inventory.errors.unitNotDeletable",
    });
  });
});

describe("prices", () => {
  it("changes a list price with history and audit; the same price is a no-op", async () => {
    const ctx = await createTenantCtx();
    const { buildingId } = await setup(ctx);
    const { id } = await createUnit(ctx, unitInput(buildingId, "A-02-01"));

    const change = (price: string) =>
      updateUnitPrice(ctx, updateUnitPriceSchema.parse({ unitId: id, price, reason: "Lancement" }));
    await change("12 500 000");
    await change("13 000 000,00");
    await change("13000000");

    const history = await rows(ctx, (tx) =>
      tx
        .select({ old: unitPriceHistory.oldPrice, new: unitPriceHistory.newPrice })
        .from(unitPriceHistory)
        .where(eq(unitPriceHistory.unitId, id)),
    );
    expect(history).toEqual(
      expect.arrayContaining([
        { old: null, new: 1_250_000_000n },
        { old: 1_250_000_000n, new: 1_300_000_000n },
      ]),
    );
    expect(history).toHaveLength(2);
    expect((await getUnit(ctx, id))?.listPrice).toBe(1_300_000_000n);
  });
});

describe("deletion rules", () => {
  it("deletes only empty buildings and projects", async () => {
    const ctx = await createTenantCtx();
    const { projectId, buildingId } = await setup(ctx);
    const { id } = await createUnit(ctx, unitInput(buildingId, "A-02-01"));

    await expect(deleteBuilding(ctx, { buildingId })).rejects.toMatchObject({
      messageKey: "inventory.errors.buildingHasUnits",
    });
    await expect(deleteProject(ctx, { projectId })).rejects.toMatchObject({
      messageKey: "inventory.errors.projectHasUnits",
    });
    await deleteUnit(ctx, { unitId: id });
    await deleteProject(ctx, { projectId });
    expect(await listProjects(ctx)).toEqual([]);
    // A deleted code can be reused.
    await setup(ctx);
  });
});

describe("permissions", () => {
  it("lets a sales agent read but not change inventory", async () => {
    const owner = await createTenantCtx();
    const { projectId, buildingId } = await setup(owner);
    const { id } = await createUnit(owner, unitInput(buildingId, "A-02-01"));
    const agent: TenantCtx = { ...owner, roles: ["sales_agent"] };

    expect(await listProjects(agent)).toHaveLength(1);
    const forbidden = { code: "FORBIDDEN" };
    await expect(
      createProject(agent, createProjectSchema.parse({ code: "X", name: "X", status: "planning" })),
    ).rejects.toMatchObject(forbidden);
    await expect(createUnit(agent, unitInput(buildingId, "A-02-02"))).rejects.toMatchObject(
      forbidden,
    );
    await expect(
      blockUnit(agent, unitStatusReasonSchema.parse({ unitId: id, reason: "x" })),
    ).rejects.toMatchObject(forbidden);
    await expect(
      updateUnitPrice(agent, updateUnitPriceSchema.parse({ unitId: id, price: "1", reason: "x" })),
    ).rejects.toMatchObject(forbidden);
    await expect(
      deleteProject({ ...owner, roles: ["sales_manager"] }, { projectId }),
    ).rejects.toMatchObject(forbidden);
    await expect(listProjects({ ...owner, roles: ["resident"] })).rejects.toMatchObject(forbidden);
  });
});

describe("tenant integrity", () => {
  it("cannot attach a unit to another tenant's building, even bypassing services", async () => {
    const a = await createTenantCtx();
    const b = await createTenantCtx();
    const { projectId, buildingId } = await setup(a);

    // RLS hides A's building from B…
    expect(await getBuildingGrid(b, buildingId)).toBeNull();
    // …and the composite FK refuses a raw insert pointing at it.
    await expect(
      withTenant(b, (tx) =>
        tx
          .insert(unit)
          .values({ organizationId: b.orgId, projectId, buildingId, code: "X", floor: 0 }),
      ),
    ).rejects.toThrow();
    // Same for a building under A's project.
    await expect(
      withTenant(b, (tx) =>
        tx
          .insert(building)
          .values({ organizationId: b.orgId, projectId, code: "Z", name: "Z", topFloor: 1 }),
      ),
    ).rejects.toThrow();
    const leaked = await withTenant(b, (tx) =>
      tx.select().from(project).where(eq(project.id, projectId)),
    );
    expect(leaked).toEqual([]);
  });

  it("keeps unit history append-only for the app role", async () => {
    const ctx = await createTenantCtx();
    const { buildingId } = await setup(ctx);
    await createUnit(ctx, unitInput(buildingId, "A-02-01"));
    await expect(
      withTenant(ctx, (tx) =>
        tx.delete(unitStatusHistory).where(eq(unitStatusHistory.organizationId, ctx.orgId)),
      ),
    ).rejects.toThrow();
  });
});
