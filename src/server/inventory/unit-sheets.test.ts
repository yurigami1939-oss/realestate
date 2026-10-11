import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { file, project, unit, unitSheet } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";

import { createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getProject, getUnit } from "./queries";
import { createProjectSchema, updateUnitPriceSchema, updateUnitSchema } from "./schemas";
import { createProject, updateUnitPrice } from "./service";
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

  it("links the virtual tours and prints them as a QR code on the sheet", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const unitId = setup.unitIds[1];
    const base = { code: "TOUR", name: "Les Pins", status: "planning" };
    expect(() =>
      createProjectSchema.parse({ ...base, virtualTourUrl: "http://visite.example.test/pins" }),
    ).toThrow();
    expect(() =>
      createProjectSchema.parse({ ...base, virtualTourUrl: "javascript:alert(1)" }),
    ).toThrow();
    expect(createProjectSchema.parse({ ...base, virtualTourUrl: "" }).virtualTourUrl).toBeNull();
    const { id } = await createProject(
      team.owner,
      createProjectSchema.parse({ ...base, virtualTourUrl: "https://visite.example.test/pins" }),
    );
    expect((await getProject(team.owner, id))?.virtualTourUrl).toBe(
      "https://visite.example.test/pins",
    );

    // The project's tour on its units' sheets, until a unit has its own.
    const [{ projectId } = { projectId: "" }] = await withTenant(team.owner, (tx) =>
      tx.select({ projectId: unit.projectId }).from(unit).where(eq(unit.id, unitId)),
    );
    await withTenant(team.owner, (tx) =>
      tx
        .update(project)
        .set({ virtualTourUrl: "https://visite.example.test/oliviers" })
        .where(eq(project.id, projectId)),
    );
    const first = await issueUnitSheet(team.agentA, { unitId });
    const loaded = await withTenant(team.owner, (tx) => loadUnitSheetData(tx, first.id));
    if (!loaded) throw new Error("sheet not found");
    expect(loaded.data.virtualTourUrl).toBe("https://visite.example.test/oliviers");
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
    expect(html).toContain("Visite virtuelle");
    expect(html).toContain("data:image/svg+xml");
    expect(html).toContain("https://visite.example.test/oliviers");

    const current = await getUnit(team.owner, unitId);
    if (!current) throw new Error("unit missing");
    expect(current.virtualTour).toBe("https://visite.example.test/oliviers");
    expect(() =>
      updateUnitSchema.parse({ unitId, buildingId: current.buildingId, virtualTourUrl: "ftp://x" }),
    ).toThrow();
    await withTenant(team.owner, (tx) =>
      tx
        .update(unit)
        .set({ virtualTourUrl: "https://visite.example.test/a-03-02" })
        .where(eq(unit.id, unitId)),
    );
    expect((await getUnit(team.owner, unitId))?.virtualTour).toBe(
      "https://visite.example.test/a-03-02",
    );
    // Another tour: a new sheet the same day.
    const second = await issueUnitSheet(team.agentA, { unitId });
    expect(second.reused).toBe(false);
    const again = await withTenant(team.owner, (tx) => loadUnitSheetData(tx, second.id));
    expect(again?.data.virtualTourUrl).toBe("https://visite.example.test/a-03-02");
  });
});
