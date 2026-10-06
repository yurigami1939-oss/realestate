import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import { building, file, project, unit, unitSheet } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import { type UnitSheetData, UnitSheetTemplate } from "@/pdf/templates/unit-sheet";
import { storeFile } from "@/server/files/service";
import { getObjectBytes } from "@/server/files/storage";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

/** Everything a sheet prints, with its floor plan as a data URI when it is an image. */
export async function loadUnitSheetData(
  tx: Tx,
  sheetId: string,
): Promise<{ data: UnitSheetData; unitId: string; pdfFileId: string | null } | null> {
  const [row] = await tx
    .select({
      sheet: unitSheet,
      unit,
      buildingName: building.name,
      projectName: project.name,
      projectAddress: project.address,
      plannedDeliveryOn: project.plannedDeliveryOn,
    })
    .from(unitSheet)
    .innerJoin(unit, eq(unit.id, unitSheet.unitId))
    .innerJoin(building, eq(building.id, unit.buildingId))
    .innerJoin(project, eq(project.id, unit.projectId))
    .where(eq(unitSheet.id, sheetId));
  if (!row) return null;
  let plan: string | null = null;
  if (row.unit.floorPlanFileId) {
    const [stored] = await tx
      .select({ storageKey: file.storageKey, contentType: file.contentType })
      .from(file)
      .where(and(eq(file.id, row.unit.floorPlanFileId), isNull(file.deletedAt)));
    if (stored && stored.contentType.startsWith("image/")) {
      const bytes = await getObjectBytes(stored.storageKey);
      plan = `data:${stored.contentType};base64,${Buffer.from(bytes).toString("base64")}`;
    }
  }
  return {
    unitId: row.unit.id,
    pdfFileId: row.sheet.pdfFileId,
    data: {
      issuedOn: row.sheet.issuedOn,
      projectName: row.projectName,
      projectAddress: row.projectAddress,
      plannedDeliveryOn: row.plannedDeliveryOn,
      buildingName: row.buildingName,
      code: row.unit.code,
      type: row.unit.type,
      typology: row.unit.typology,
      floor: row.unit.floor,
      isDuplex: row.unit.isDuplex,
      livingArea: row.unit.livingArea,
      usableArea: row.unit.usableArea,
      outdoorArea: row.unit.outdoorArea,
      orientations: row.unit.orientations,
      status: row.sheet.status,
      listPrice: row.sheet.listPrice,
      planName: row.sheet.planName,
      lines: row.sheet.lines.map((l) => ({ ...l, amount: BigInt(l.amount) })),
      plan,
    },
  };
}

export function unitSheetHtml(data: UnitSheetData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(UnitSheetTemplate, { data, company }),
  )}`;
}

/** `pdf.document` (unit_sheet): rendered once, filed under the unit. */
export async function renderAndStoreUnitSheet(
  organizationId: string,
  sheetId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const sheet = await loadUnitSheetData(tx, sheetId);
    if (!sheet || sheet.pdfFileId) return null;
    return { sheet, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(await renderPdf(unitSheetHtml(loaded.sheet.data, loaded.company)));
  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: unitSheet.pdfFileId })
      .from(unitSheet)
      .where(eq(unitSheet.id, sheetId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const { data } = loaded.sheet;
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        entityType: "unit",
        entityId: loaded.sheet.unitId,
        upload: { fileName: `Fiche-${data.code}-${data.issuedOn}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx.update(unitSheet).set({ pdfFileId: stored.id }).where(eq(unitSheet.id, sheetId));
    return "stored";
  });
}
