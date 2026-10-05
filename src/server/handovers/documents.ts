import "server-only";

import { asc, eq, ne, and } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import {
  building,
  buyer,
  handover,
  project,
  punchItem,
  reservation,
  reservationBuyer,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import {
  type DeliveredUnit,
  type HandoverPvData,
  HandoverPvTemplate,
} from "@/pdf/templates/handover-pv";
import {
  type HandoverReleaseData,
  HandoverReleaseTemplate,
} from "@/pdf/templates/handover-release";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

/** Entity type of the stored delivery documents (`file.entity_type`). */
export const HANDOVER_ENTITY = "handover";

/** The handover with its unit and buyers as printed on both documents; null if unknown. */
async function loadDelivery(tx: Tx, handoverId: string) {
  const [row] = await tx
    .select({
      handover,
      projectName: project.name,
      address: project.address,
      commune: project.commune,
      wilaya: project.wilaya,
      buildingName: building.name,
      unitCode: unit.code,
      unitTypology: unit.typology,
      livingArea: unit.livingArea,
      usableArea: unit.usableArea,
      saleNumber: reservation.saleNumber,
      saleSignedOn: reservation.saleSignedOn,
      saleNotary: reservation.saleNotary,
      signedByName: user.name,
    })
    .from(handover)
    .innerJoin(reservation, eq(reservation.id, handover.reservationId))
    .innerJoin(unit, eq(unit.id, handover.unitId))
    .innerJoin(building, eq(building.id, unit.buildingId))
    .innerJoin(project, eq(project.id, unit.projectId))
    .leftJoin(user, eq(user.id, handover.signedBy))
    .where(eq(handover.id, handoverId));
  if (!row) return null;
  const buyers = await tx
    .select({
      lastName: buyer.lastName,
      firstName: buyer.firstName,
      lastNameAr: buyer.lastNameAr,
      firstNameAr: buyer.firstNameAr,
      nin: buyer.nin,
    })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(eq(reservationBuyer.reservationId, row.handover.reservationId))
    .orderBy(asc(reservationBuyer.position));
  const delivered: DeliveredUnit = {
    projectName: row.projectName,
    projectAddress: [row.address, row.commune, row.wilaya].filter(Boolean).join(", "),
    buildingName: row.buildingName,
    unitCode: row.unitCode,
    unitTypology: row.unitTypology,
    area: row.livingArea ?? row.usableArea,
    saleNumber: row.saleNumber,
    saleSignedOn: row.saleSignedOn,
    saleNotary: row.saleNotary,
    buyers,
  };
  return { handover: row.handover, delivered, signedByName: row.signedByName };
}

/** Everything printed on the PV de remise des clés (null if unknown or not signed). */
export async function loadHandoverPvData(
  tx: Tx,
  handoverId: string,
): Promise<{ data: HandoverPvData; fileId: string | null } | null> {
  const loaded = await loadDelivery(tx, handoverId);
  const h = loaded?.handover;
  if (!loaded || !h || h.status !== "signed" || !h.number || !h.signedOn) return null;
  return {
    fileId: h.pdfFileId,
    data: {
      ...loaded.delivered,
      number: h.number,
      signedOn: h.signedOn,
      receivedBy: h.receivedBy ?? "",
      keysCount: h.keysCount ?? 0,
      electricityMeter: h.electricityMeter,
      gasMeter: h.gasMeter,
      waterMeter: h.waterMeter,
      observations: h.observations,
      outstanding: h.outstanding ?? 0n,
      reserves: h.reserves ?? [],
      signedByName: loaded.signedByName,
    },
  };
}

/** Everything printed on the PV de levée des réserves (null if the reserves are not closed). */
export async function loadHandoverReleaseData(
  tx: Tx,
  handoverId: string,
): Promise<{ data: HandoverReleaseData; fileId: string | null } | null> {
  const loaded = await loadDelivery(tx, handoverId);
  const h = loaded?.handover;
  if (!loaded || !h?.number || !h.signedOn || !h.reservesClosedOn) return null;
  const items = await tx
    .select({
      position: punchItem.position,
      location: punchItem.location,
      description: punchItem.description,
      trade: punchItem.trade,
      status: punchItem.status,
      liftedOn: punchItem.liftedOn,
      cancelReason: punchItem.cancelReason,
    })
    .from(punchItem)
    .where(and(eq(punchItem.handoverId, h.id), ne(punchItem.status, "open")))
    .orderBy(asc(punchItem.position));
  return {
    fileId: h.releaseFileId,
    data: {
      ...loaded.delivered,
      number: h.number,
      signedOn: h.signedOn,
      closedOn: h.reservesClosedOn,
      reserves: items.map((i) => ({
        ...i,
        status: i.status === "lifted" ? "lifted" : "cancelled",
      })),
    },
  };
}

export function handoverPvHtml(data: HandoverPvData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(HandoverPvTemplate, { data, company }),
  )}`;
}

export function handoverReleaseHtml(data: HandoverReleaseData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(HandoverReleaseTemplate, { data, company }),
  )}`;
}

type Kind = "pv" | "release";

/** Renders one delivery document once and links it to the handover, filed under it. */
async function renderAndStore(
  organizationId: string,
  handoverId: string,
  kind: Kind,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const document =
      kind === "pv"
        ? await loadHandoverPvData(tx, handoverId)
        : await loadHandoverReleaseData(tx, handoverId);
    if (!document || document.fileId) return null;
    return { document, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const { document, company } = loaded;
  const html =
    kind === "pv"
      ? handoverPvHtml(document.data as HandoverPvData, company)
      : handoverReleaseHtml(document.data as HandoverReleaseData, company);
  const bytes = new Uint8Array(await renderPdf(html));
  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: handover.pdfFileId, releaseFileId: handover.releaseFileId })
      .from(handover)
      .where(eq(handover.id, handoverId))
      .for("update");
    if (!current || (kind === "pv" ? current.pdfFileId : current.releaseFileId)) return "skipped";
    const number = document.data.number;
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        entityType: HANDOVER_ENTITY,
        entityId: handoverId,
        upload: {
          fileName: kind === "pv" ? `${number}.pdf` : `${number}-levee-des-reserves.pdf`,
          bytes,
        },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(handover)
      .set(kind === "pv" ? { pdfFileId: stored.id } : { releaseFileId: stored.id })
      .where(eq(handover.id, handoverId));
    return "stored";
  });
}

/** `pdf.document` (handover_pv): the PV de remise des clés, rendered once at signing. */
export const renderAndStoreHandoverPv = (organizationId: string, handoverId: string) =>
  renderAndStore(organizationId, handoverId, "pv");

/** `pdf.document` (handover_release): the PV de levée des réserves, rendered once at closing. */
export const renderAndStoreHandoverRelease = (organizationId: string, handoverId: string) =>
  renderAndStore(organizationId, handoverId, "release");
