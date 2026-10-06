import "server-only";

import { asc, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import {
  type AmendmentLine,
  buyer,
  project,
  reservation,
  reservationBuyer,
  scheduleAmendment,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import {
  type ScheduleAmendmentData,
  ScheduleAmendmentTemplate,
} from "@/pdf/templates/schedule-amendment";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

const line = (l: AmendmentLine) => ({ ...l, amount: BigInt(l.amount) });

/** Everything printed on an avenant (null if unknown). */
export async function loadAmendmentData(
  tx: Tx,
  amendmentId: string,
): Promise<{
  data: ScheduleAmendmentData;
  pdfFileId: string | null;
  reservationId: string;
} | null> {
  const [row] = await tx
    .select({
      amendment: scheduleAmendment,
      saleNumber: reservation.number,
      saleDeedNumber: reservation.saleNumber,
      reservedOn: reservation.reservedOn,
      price: reservation.price,
      unitCode: unit.code,
      projectName: project.name,
    })
    .from(scheduleAmendment)
    .innerJoin(reservation, eq(reservation.id, scheduleAmendment.reservationId))
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .where(eq(scheduleAmendment.id, amendmentId));
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
    .where(eq(reservationBuyer.reservationId, row.amendment.reservationId))
    .orderBy(asc(reservationBuyer.position));
  const a = row.amendment;
  return {
    pdfFileId: a.pdfFileId,
    reservationId: a.reservationId,
    data: {
      sequence: a.sequence,
      signedOn: a.signedOn,
      reason: a.reason,
      saleNumber: row.saleNumber,
      saleDeedNumber: row.saleDeedNumber,
      reservedOn: row.reservedOn,
      projectName: row.projectName,
      unitCode: row.unitCode,
      price: row.price,
      paid: a.paid,
      replaced: a.replaced.map(line),
      lines: a.lines.map(line),
      buyers: buyers.map((b) => ({
        name: `${b.lastName} ${b.firstName}`,
        nameAr: [b.lastNameAr, b.firstNameAr].filter(Boolean).join(" ") || null,
        nin: b.nin,
      })),
    },
  };
}

export function scheduleAmendmentHtml(
  data: ScheduleAmendmentData,
  company: CompanyIdentity,
): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(ScheduleAmendmentTemplate, { data, company }),
  )}`;
}

/** `pdf.document` (schedule_amendment): rendered once, filed under its sale. */
export async function renderAndStoreScheduleAmendment(
  organizationId: string,
  amendmentId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const amendment = await loadAmendmentData(tx, amendmentId);
    if (!amendment || amendment.pdfFileId) return null;
    return { amendment, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(
    await renderPdf(scheduleAmendmentHtml(loaded.amendment.data, loaded.company)),
  );

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: scheduleAmendment.pdfFileId })
      .from(scheduleAmendment)
      .where(eq(scheduleAmendment.id, amendmentId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const { data } = loaded.amendment;
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        // Filed under the sale: readers follow the sale's visibility (and its buyers' portal).
        entityType: "reservation",
        entityId: loaded.amendment.reservationId,
        upload: { fileName: `Avenant-${data.sequence}-${data.saleNumber}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(scheduleAmendment)
      .set({ pdfFileId: stored.id })
      .where(eq(scheduleAmendment.id, amendmentId));
    return "stored";
  });
}
