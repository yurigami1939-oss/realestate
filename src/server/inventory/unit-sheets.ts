import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import { building, file, project, unit, unitSheet, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { buildSchedule } from "@/lib/payment-plans";
import { AppError } from "@/lib/result";
import { renderPdf } from "@/pdf/render";
import { type UnitSheetData, UnitSheetTemplate } from "@/pdf/templates/unit-sheet";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { getObjectBytes } from "@/server/files/storage";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";
import { loadMilestones, loadPaymentPlans } from "@/server/payment-plans/queries";

/**
 * Fiche du lot for a prospect (`inventory:read`, CLAUDE.md §7 Inventory): the unit with its
 * asking price and the project's default payment plan as today. The same day's sheet is
 * reused while the price and the status are unchanged; else a new one is rendered.
 */
export async function issueUnitSheet(ctx: TenantCtx, input: { unitId: string }) {
  assertCan(ctx, "inventory:read");
  if (!isUuid(input.unitId)) throw new AppError("NOT_FOUND");
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [target] = await tx
      .select({
        id: unit.id,
        projectId: unit.projectId,
        status: unit.status,
        listPrice: unit.listPrice,
      })
      .from(unit)
      .where(and(eq(unit.id, input.unitId), isNull(unit.deletedAt)));
    if (!target) throw new AppError("NOT_FOUND");
    const [latest] = await tx
      .select({
        id: unitSheet.id,
        status: unitSheet.status,
        listPrice: unitSheet.listPrice,
      })
      .from(unitSheet)
      .where(and(eq(unitSheet.unitId, target.id), eq(unitSheet.issuedOn, today)))
      .orderBy(desc(unitSheet.createdAt))
      .limit(1);
    if (latest && latest.status === target.status && latest.listPrice === target.listPrice) {
      return { id: latest.id, reused: true };
    }

    const [plan] = await loadPaymentPlans(tx, target.projectId);
    const milestones = await loadMilestones(tx, target.projectId);
    const lines =
      plan && target.listPrice !== null
        ? buildSchedule(target.listPrice, plan.steps, today, milestones).map((line, index) => ({
            label: line.label,
            shareBp: line.shareBp,
            amount: line.amount.toString(),
            trigger: line.trigger,
            months: plan.steps[index]?.months ?? null,
            milestoneName: line.milestoneName,
          }))
        : [];
    const [row] = await tx
      .insert(unitSheet)
      .values({
        organizationId: ctx.orgId,
        unitId: target.id,
        issuedOn: today,
        status: target.status,
        listPrice: target.listPrice,
        planName: plan?.name ?? null,
        lines,
        createdBy: ctx.userId,
      })
      .returning({ id: unitSheet.id });
    if (!row) throw new Error("issueUnitSheet: no row returned");
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "unit_sheet", id: row.id },
      { singletonKey: row.id },
    );
    return { id: row.id, reused: false };
  });
}

/** The unit's latest sheets (unit page). */
export async function listUnitSheets(ctx: TenantCtx, unitId: string) {
  assertCan(ctx, "inventory:read");
  if (!isUuid(unitId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: unitSheet.id,
        issuedOn: unitSheet.issuedOn,
        listPrice: unitSheet.listPrice,
        createdByName: user.name,
        pdfFileId: unitSheet.pdfFileId,
      })
      .from(unitSheet)
      .innerJoin(user, eq(user.id, unitSheet.createdBy))
      .where(eq(unitSheet.unitId, unitId))
      .orderBy(desc(unitSheet.createdAt))
      .limit(5),
  );
}

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
