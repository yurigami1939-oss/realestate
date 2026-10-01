import "server-only";

import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { reservation } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import { ReservationSheetTemplate } from "@/pdf/templates/reservation-sheet";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

import { loadSale, type SaleDetail } from "./sale-queries";

export function reservationSheetHtml(sale: SaleDetail, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(ReservationSheetTemplate, { sale, company }),
  )}`;
}

/** `pdf.document` (reservation_sheet): rendered once, linked to the reservation. */
export async function renderAndStoreReservationSheet(
  organizationId: string,
  reservationId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const data = await withTenant(scope, async (tx) => {
    const sale = await loadSale(tx, organizationId, reservationId);
    if (!sale || sale.sheetFileId) return null;
    return { sale, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!data) return "skipped";
  const bytes = new Uint8Array(await renderPdf(reservationSheetHtml(data.sale, data.company)));

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ sheetFileId: reservation.sheetFileId })
      .from(reservation)
      .where(eq(reservation.id, reservationId))
      .for("update");
    if (!current || current.sheetFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        entityType: "reservation",
        entityId: reservationId,
        upload: { fileName: `${data.sale.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(reservation)
      .set({ sheetFileId: stored.id })
      .where(eq(reservation.id, reservationId));
    return "stored";
  });
}
