import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { file, unitSheet } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";

import { createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { updateUnitPriceSchema } from "./schemas";
import { updateUnitPrice } from "./service";
import { loadUnitSheetData, renderAndStoreUnitSheet, unitSheetHtml } from "./unit-sheet-documents";
import { issueUnitSheet, listUnitSheets } from "./unit-sheets";

afterAll(async () => {
  await stopEnqueue();
});

describe("unit sheets", () => {
  it("draws the fiche du lot with the default plan, reused until the price changes", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const unitId = setup.unitIds[0];

    const first = await issueUnitSheet(team.agentA, { unitId });
    expect(first.reused).toBe(false);
    expect(await issueUnitSheet(team.agentA, { unitId })).toEqual({ id: first.id, reused: true });

    const loaded = await withTenant(team.owner, (tx) => loadUnitSheetData(tx, first.id));
    if (!loaded) throw new Error("sheet not found");
    expect(loaded.data).toMatchObject({
      code: "A-03-01",
      status: "available",
      listPrice: 1_301_000_000n,
      planName: "VSP standard",
    });
    expect(loaded.data.lines.map((l) => [l.shareBp, l.amount])).toEqual([
      [2_000, 260_200_000n],
      [3_000, 390_300_000n],
      [5_000, 650_500_000n],
    ]);
    const html = unitSheetHtml(loaded.data, {
      name: "El Bahdja",
      legalName: null,
      address: null,
      wilaya: null,
      phone: null,
      rcNumber: null,
      nif: null,
      nis: null,
      aiNumber: null,
    });
    expect(html).toContain("FICHE DU LOT");
    expect(html).toContain("Disponible");
    expect(html).toContain('dir="rtl"');

    expect(await renderAndStoreUnitSheet(team.orgId, first.id)).toBe("stored");
    const [stored] = await withTenant(team.owner, (tx) =>
      tx
        .select({ entityType: file.entityType, entityId: file.entityId })
        .from(unitSheet)
        .innerJoin(file, eq(file.id, unitSheet.pdfFileId))
        .where(eq(unitSheet.id, first.id)),
    );
    expect(stored).toEqual({ entityType: "unit", entityId: unitId });

    // A new price: a new sheet the same day.
    await updateUnitPrice(
      team.manager,
      updateUnitPriceSchema.parse({ unitId, price: "13 500 000", reason: "Révision" }),
    );
    const second = await issueUnitSheet(team.agentA, { unitId });
    expect(second.reused).toBe(false);
    expect((await listUnitSheets(team.agentA, unitId)).map((s) => s.id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});
