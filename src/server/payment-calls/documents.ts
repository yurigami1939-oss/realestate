import "server-only";

import { asc, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import {
  building,
  buyer,
  constructionMilestone,
  paymentCall,
  project,
  reservation,
  reservationBuyer,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import { type PaymentCallData, PaymentCallTemplate } from "@/pdf/templates/payment-call";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyProfile } from "@/server/organizations/settings";

/** Everything printed on a payment call (null if unknown). */
export async function loadPaymentCallData(
  tx: Tx,
  callId: string,
): Promise<{ data: PaymentCallData; pdfFileId: string | null; reservationId: string } | null> {
  const [row] = await tx
    .select({
      call: paymentCall,
      saleNumber: reservation.number,
      saleDeedNumber: reservation.saleNumber,
      unitCode: unit.code,
      buildingName: building.name,
      projectName: project.name,
      milestoneName: constructionMilestone.name,
      validatedOn: constructionMilestone.validatedOn,
    })
    .from(paymentCall)
    .innerJoin(reservation, eq(reservation.id, paymentCall.reservationId))
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(building, eq(building.id, unit.buildingId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .innerJoin(constructionMilestone, eq(constructionMilestone.id, paymentCall.milestoneId))
    .where(eq(paymentCall.id, callId));
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
    .where(eq(reservationBuyer.reservationId, row.call.reservationId))
    .orderBy(asc(reservationBuyer.position));

  const c = row.call;
  return {
    pdfFileId: c.pdfFileId,
    reservationId: c.reservationId,
    data: {
      number: c.number,
      issuedAt: c.issuedAt,
      saleNumber: row.saleNumber,
      saleDeedNumber: row.saleDeedNumber,
      projectName: row.projectName,
      buildingName: row.buildingName,
      unitCode: row.unitCode,
      milestoneName: row.milestoneName,
      validatedOn: row.validatedOn ?? c.dueOn,
      label: c.label,
      amount: c.amount,
      settled: c.settled,
      called: c.called,
      dueOn: c.dueOn,
      buyers: buyers.map((b) => ({
        name: `${b.lastName} ${b.firstName}`,
        nameAr: [b.lastNameAr, b.firstNameAr].filter(Boolean).join(" ") || null,
        address: [b.address, b.commune, b.wilaya].filter(Boolean).join(", "),
      })),
    },
  };
}

export function paymentCallHtml(data: PaymentCallData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(PaymentCallTemplate, { data, company }),
  )}`;
}

/** `pdf.document` (payment_call): rendered once, filed under its sale. */
export async function renderAndStorePaymentCall(
  organizationId: string,
  callId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const call = await loadPaymentCallData(tx, callId);
    if (!call || call.pdfFileId) return null;
    return { call, company: await loadCompanyProfile(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(await renderPdf(paymentCallHtml(loaded.call.data, loaded.company)));

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: paymentCall.pdfFileId })
      .from(paymentCall)
      .where(eq(paymentCall.id, callId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        // Filed under the sale: readers follow the sale's visibility.
        entityType: "reservation",
        entityId: loaded.call.reservationId,
        upload: { fileName: `${loaded.call.data.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx.update(paymentCall).set({ pdfFileId: stored.id }).where(eq(paymentCall.id, callId));
    return "stored";
  });
}
