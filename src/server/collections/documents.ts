import "server-only";

import { asc, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import {
  buyer,
  project,
  reminderLetter,
  reservation,
  reservationBuyer,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import {
  type ReminderLetterData,
  ReminderLetterTemplate,
} from "@/pdf/templates/reminder-letter";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyProfile } from "@/server/organizations/settings";

/** Everything printed on a reminder letter (null if unknown). */
export async function loadReminderLetterData(
  tx: Tx,
  letterId: string,
): Promise<{ data: ReminderLetterData; pdfFileId: string | null; reservationId: string } | null> {
  const [row] = await tx
    .select({
      letter: reminderLetter,
      saleNumber: reservation.number,
      saleDeedNumber: reservation.saleNumber,
      unitCode: unit.code,
      projectName: project.name,
    })
    .from(reminderLetter)
    .innerJoin(reservation, eq(reservation.id, reminderLetter.reservationId))
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .where(eq(reminderLetter.id, letterId));
  if (!row) return null;
  const buyers = await tx
    .select({
      lastName: buyer.lastName,
      firstName: buyer.firstName,
      lastNameAr: buyer.lastNameAr,
      firstNameAr: buyer.firstNameAr,
      address: buyer.address,
      commune: buyer.commune,
      wilaya: buyer.wilaya,
    })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(eq(reservationBuyer.reservationId, row.letter.reservationId))
    .orderBy(asc(reservationBuyer.position));

  const l = row.letter;
  return {
    pdfFileId: l.pdfFileId,
    reservationId: l.reservationId,
    data: {
      issuedAt: l.issuedAt,
      saleNumber: row.saleNumber,
      saleDeedNumber: row.saleDeedNumber,
      projectName: row.projectName,
      unitCode: row.unitCode,
      payBy: l.payBy,
      overdue: l.overdue,
      penalties: l.penalties,
      lines: l.lines.map((line) => ({
        label: line.label,
        dueOn: line.dueOn,
        remaining: BigInt(line.remaining),
        daysLate: line.daysLate,
        penalty: BigInt(line.penalty),
      })),
      buyers: buyers.map((b) => ({
        name: `${b.lastName} ${b.firstName}`,
        nameAr: [b.lastNameAr, b.firstNameAr].filter(Boolean).join(" ") || null,
        address: [b.address, b.commune, b.wilaya].filter(Boolean).join(", "),
      })),
    },
  };
}

export function reminderLetterHtml(data: ReminderLetterData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(ReminderLetterTemplate, { data, company }),
  )}`;
}

/** `pdf.document` (reminder_letter): rendered once, filed under its sale. */
export async function renderAndStoreReminderLetter(
  organizationId: string,
  letterId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const letter = await loadReminderLetterData(tx, letterId);
    if (!letter || letter.pdfFileId) return null;
    return { letter, company: await loadCompanyProfile(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(
    await renderPdf(reminderLetterHtml(loaded.letter.data, loaded.company)),
  );

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: reminderLetter.pdfFileId })
      .from(reminderLetter)
      .where(eq(reminderLetter.id, letterId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        // Filed under the sale: readers follow the sale's visibility.
        entityType: "reservation",
        entityId: loaded.letter.reservationId,
        upload: {
          fileName: `Relance-${loaded.letter.data.saleNumber}-${loaded.letter.data.payBy}.pdf`,
          bytes,
        },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(reminderLetter)
      .set({ pdfFileId: stored.id })
      .where(eq(reminderLetter.id, letterId));
    return "stored";
  });
}
