import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, unitPriceHistory } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { TenantCtx } from "@/server/auth/session";

import { createTenantCtx } from "../../../tests/factories";

import {
  applyPriceList,
  createPriceList,
  discardPriceList,
  setPriceListItems,
} from "./price-lists";
import { getPriceList, getUnit, listPriceLists } from "./queries";
import {
  createBuildingSchema,
  createPriceListSchema,
  createProjectSchema,
  generateUnitsSchema,
  setPriceListItemsSchema,
  updateUnitPriceSchema,
} from "./schemas";
import { createBuilding, createProject, generateUnits, updateUnitPrice } from "./service";

/** A project with 4 units (A-00-01, A-00-02, A-01-01, A-01-02); the first two are priced. */
async function pricedProject(ctx: TenantCtx) {
  const { id: projectId } = await createProject(
    ctx,
    createProjectSchema.parse({ code: "OLIV", name: "Les Oliviers", status: "planning" }),
  );
  const { id: buildingId } = await createBuilding(
    ctx,
    createBuildingSchema.parse({
      projectId,
      code: "A",
      name: "Bloc A",
      lowestFloor: "0",
      topFloor: "3",
    }),
  );
  await generateUnits(
    ctx,
    generateUnitsSchema.parse({
      buildingId,
      fromFloor: "0",
      toFloor: "1",
      unitsPerFloor: "2",
      type: "apartment",
    }),
  );
  const draft = await getPriceListRows(ctx, projectId);
  const [first, second] = draft;
  for (const [row, price] of [
    [first, "10 000 000"],
    [second, "11 000 000"],
  ] as const) {
    await updateUnitPrice(
      ctx,
      updateUnitPriceSchema.parse({ unitId: row?.unitId, price, reason: "Initial" }),
    );
  }
  return { projectId, units: draft };
}

/** Units of the project in grid order (via a throwaway draft). */
async function getPriceListRows(ctx: TenantCtx, projectId: string) {
  const { id } = await createPriceList(
    ctx,
    createPriceListSchema.parse({ projectId, name: "tmp" }),
  );
  const detail = await getPriceList(ctx, id);
  await discardPriceList(ctx, { priceListId: id });
  return [...(detail?.rows ?? [])].sort((a, b) => a.code.localeCompare(b.code));
}

describe("price lists", () => {
  it("numbers drafts per project and prefills them with current prices", async () => {
    const ctx = await createTenantCtx();
    const { projectId } = await pricedProject(ctx);

    const { id, version } = await createPriceList(
      ctx,
      createPriceListSchema.parse({ projectId, name: "Grille 2027" }),
    );
    expect(version).toBe(2); // version 1 was the discarded helper draft

    const detail = await getPriceList(ctx, id);
    const priced = detail?.rows.filter((r) => r.price !== null).map((r) => [r.code, r.price]);
    expect(priced?.sort()).toEqual([
      ["A-00-01", 1_000_000_000n],
      ["A-00-02", 1_100_000_000n],
    ]);
    expect(detail?.rows).toHaveLength(4);
  });

  it("applies only changed prices, with history and one audit entry, then locks the list", async () => {
    const ctx = await createTenantCtx(["sales_manager"]);
    const { projectId, units } = await pricedProject({ ...ctx, roles: ["owner"] });
    const [u1, u2, u3] = units;
    const { id } = await createPriceList(
      ctx,
      createPriceListSchema.parse({ projectId, name: "Grille 2027" }),
    );

    await setPriceListItems(
      ctx,
      setPriceListItemsSchema.parse({
        priceListId: id,
        items: [
          { unitId: u1?.unitId, price: "10 000 000" }, // unchanged
          { unitId: u2?.unitId, price: "11 500 000" }, // +500 000
          { unitId: u3?.unitId, price: "9 800 000,50" }, // first price
        ],
      }),
    );
    expect(await applyPriceList(ctx, { priceListId: id })).toEqual({ changed: 2 });

    expect((await getUnit(ctx, u2?.unitId ?? ""))?.listPrice).toBe(1_150_000_000n);
    expect((await getUnit(ctx, u3?.unitId ?? ""))?.listPrice).toBe(980_000_050n);

    const history = await withTenant(ctx, (tx) =>
      tx.select().from(unitPriceHistory).where(eq(unitPriceHistory.priceListId, id)),
    );
    expect(history).toHaveLength(2);

    const [audit] = await withTenant(ctx, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, id), eq(auditLog.action, "price_list.apply"))),
    );
    expect(audit?.after).toMatchObject({
      name: "Grille 2027",
      changes: expect.arrayContaining([{ unit: "A-00-02", from: "1100000000", to: "1150000000" }]),
    });

    await expect(setPriceListItems(ctx, { priceListId: id, items: [] })).rejects.toMatchObject({
      messageKey: "inventory.errors.priceListNotDraft",
    });
    await expect(applyPriceList(ctx, { priceListId: id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const lists = await listPriceLists(ctx, projectId);
    expect(lists.find((l) => l.id === id)?.status).toBe("applied");
  });

  it("refuses units from another project", async () => {
    const ctx = await createTenantCtx();
    const { projectId } = await pricedProject(ctx);
    const other = await createProject(
      ctx,
      createProjectSchema.parse({ code: "JARD", name: "J", status: "planning" }),
    );
    const { id: otherBuilding } = await createBuilding(
      ctx,
      createBuildingSchema.parse({
        projectId: other.id,
        code: "B",
        name: "B",
        lowestFloor: "0",
        topFloor: "1",
      }),
    );
    await generateUnits(
      ctx,
      generateUnitsSchema.parse({
        buildingId: otherBuilding,
        fromFloor: "0",
        toFloor: "0",
        unitsPerFloor: "1",
        type: "villa",
      }),
    );
    const [foreign] = await getPriceListRows(ctx, other.id);
    const { id } = await createPriceList(
      ctx,
      createPriceListSchema.parse({ projectId, name: "G" }),
    );

    await expect(
      setPriceListItems(
        ctx,
        setPriceListItemsSchema.parse({
          priceListId: id,
          items: [{ unitId: foreign?.unitId, price: "1" }],
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "inventory.errors.unitNotInProject" });
  });

  it("is reserved to price managers", async () => {
    const ctx = await createTenantCtx();
    const { projectId } = await pricedProject(ctx);
    const agent: TenantCtx = { ...ctx, roles: ["sales_agent", "cashier"] };

    await expect(
      createPriceList(agent, createPriceListSchema.parse({ projectId, name: "G" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listPriceLists(agent, projectId)).toHaveLength(1);
  });
});
