import "server-only";

import { asc, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import {
  building,
  chargeCall,
  chargeCallLine,
  chargePayment,
  chargePeriod,
  residence,
  residenceUnit,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { periodLabels } from "@/lib/charges";
import { formatDate } from "@/lib/dates";
import type { ChargePaymentMethod } from "@/lib/residences";
import { type ReceiptData, receiptHtml } from "@/pdf/receipt";
import { renderPdf } from "@/pdf/render";
import { type ChargeCallData, ChargeCallTemplate } from "@/pdf/templates/charge-call";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

/** Everything printed on a charge call (null if unknown). */
export async function loadChargeCallData(
  tx: Tx,
  callId: string,
): Promise<{ data: ChargeCallData; pdfFileId: string | null; residenceId: string } | null> {
  const [row] = await tx
    .select({
      call: chargeCall,
      period: chargePeriod,
      residenceName: residence.name,
      residenceAddress: residence.address,
      commune: residence.commune,
      wilaya: residence.wilaya,
      shareBasis: residence.shareBasis,
      unitCode: unit.code,
      buildingName: building.name,
      share: residenceUnit.share,
    })
    .from(chargeCall)
    .innerJoin(chargePeriod, eq(chargePeriod.id, chargeCall.periodId))
    .innerJoin(residence, eq(residence.id, chargeCall.residenceId))
    .innerJoin(unit, eq(unit.id, chargeCall.unitId))
    .innerJoin(building, eq(building.id, unit.buildingId))
    .innerJoin(residenceUnit, eq(residenceUnit.unitId, chargeCall.unitId))
    .where(eq(chargeCall.id, callId));
  if (!row) return null;
  const lines = await tx
    .select({
      label: chargeCallLine.label,
      labelAr: chargeCallLine.labelAr,
      amount: chargeCallLine.amount,
    })
    .from(chargeCallLine)
    .where(eq(chargeCallLine.callId, callId))
    .orderBy(asc(chargeCallLine.position));

  const c = row.call;
  return {
    pdfFileId: c.pdfFileId,
    residenceId: c.residenceId,
    data: {
      number: c.number,
      issuedOn: row.period.issuedOn,
      dueOn: c.dueOn,
      residenceName: row.residenceName,
      residenceAddress: [row.residenceAddress, row.commune, row.wilaya].filter(Boolean).join(", "),
      buildingName: row.buildingName,
      unitCode: row.unitCode,
      share: row.share,
      shareBasis: row.shareBasis,
      period: periodLabels(row.period.frequency, row.period.year, row.period.periodIndex),
      year: row.period.year,
      addressee: c.addresseeName
        ? { name: c.addresseeName, nameAr: c.addresseeNameAr, address: c.addresseeAddress }
        : null,
      lines,
      amount: c.amount,
    },
  };
}

export function chargeCallHtml(data: ChargeCallData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(createElement(ChargeCallTemplate, { data, company }))}`;
}

/** `pdf.document` (charge_call): rendered once, filed under its residence. */
export async function renderAndStoreChargeCall(
  organizationId: string,
  callId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const call = await loadChargeCallData(tx, callId);
    if (!call || call.pdfFileId) return null;
    return { call, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(await renderPdf(chargeCallHtml(loaded.call.data, loaded.company)));

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: chargeCall.pdfFileId })
      .from(chargeCall)
      .where(eq(chargeCall.id, callId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        // Filed under the residence: readers need `charge:read`.
        entityType: "residence",
        entityId: loaded.call.residenceId,
        upload: { fileName: `${loaded.call.data.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx.update(chargeCall).set({ pdfFileId: stored.id }).where(eq(chargeCall.id, callId));
    return "stored";
  });
}

const methodLabels: Record<ChargePaymentMethod, { fr: string; ar: string }> = {
  cash: { fr: "Espèces", ar: "نقداً" },
  cheque: { fr: "Chèque", ar: "صك" },
  bank_transfer: { fr: "Virement bancaire", ar: "تحويل بنكي" },
  ccp: { fr: "Versement CCP", ar: "دفع عبر الحساب البريدي الجاري" },
};

/** Everything printed on a charge receipt, resolved from the database (null if unknown). */
export async function loadChargeReceiptData(
  tx: Tx,
  orgId: string,
  paymentId: string,
): Promise<{ data: ReceiptData; pdfFileId: string | null; residenceId: string } | null> {
  const [row] = await tx
    .select({
      payment: chargePayment,
      residenceName: residence.name,
      unitCode: unit.code,
      cashier: user.name,
    })
    .from(chargePayment)
    .innerJoin(residence, eq(residence.id, chargePayment.residenceId))
    .innerJoin(unit, eq(unit.id, chargePayment.unitId))
    .innerJoin(user, eq(user.id, chargePayment.recordedBy))
    .where(eq(chargePayment.id, paymentId));
  if (!row) return null;
  const company = await loadCompanyLetterhead(tx, orgId);

  const p = row.payment;
  // Charge payments never use bank loans (checked by the table).
  const method = methodLabels[p.method === "bank_loan" ? "bank_transfer" : p.method];
  const details = (number: string) =>
    [p.reference ? `${number} ${p.reference}` : null, p.bank ? `(${p.bank})` : null]
      .filter(Boolean)
      .join(" ");
  const detailsFr = details("n°");
  const detailsAr = details("رقم");
  const settled = p.allocation.map((a) => a.number).join(", ");

  return {
    pdfFileId: p.pdfFileId,
    residenceId: p.residenceId,
    data: {
      number: p.receiptNumber,
      issuedAt: p.createdAt,
      organization: {
        legalName: company.legalName ?? company.name,
        address: [company.address, company.wilaya].filter(Boolean).join(", "),
        rcNumber: company.rcNumber ?? "",
        nif: company.nif ?? "",
        nis: company.nis ?? "",
        aiNumber: company.aiNumber ?? "",
        logo: company.logo,
      },
      payer: { fr: p.payerName, ar: p.payerName },
      reference: {
        fr: `Charges de copropriété · ${row.residenceName}, lot ${row.unitCode}${settled ? ` · ${settled}` : ""}`,
        ar: `أعباء الملكية المشتركة · ${row.residenceName}، الوحدة ${row.unitCode}${settled ? ` · ${settled}` : ""}`,
      },
      method: {
        fr: `${method.fr}${detailsFr ? ` ${detailsFr}` : ""} du ${formatDate(p.paidOn)}${
          p.method === "cheque" ? " — sous réserve d'encaissement" : ""
        }`,
        ar: `${method.ar}${detailsAr ? ` ${detailsAr}` : ""} بتاريخ ${formatDate(p.paidOn)}${
          p.method === "cheque" ? " — مع التحفظ إلى حين التحصيل" : ""
        }`,
      },
      amount: p.amount,
      cashier: row.cashier,
      title: { fr: "REÇU DE CHARGES", ar: "وصل تسديد الأعباء" },
      party: { fr: "Le copropriétaire", ar: "المالك المشترك" },
    },
  };
}

/** `pdf.document` (charge_receipt): rendered once, filed under its residence. */
export async function renderAndStoreChargeReceipt(
  organizationId: string,
  paymentId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, (tx) =>
    loadChargeReceiptData(tx, organizationId, paymentId),
  );
  if (!loaded || loaded.pdfFileId) return "skipped";
  const bytes = new Uint8Array(await renderPdf(receiptHtml(loaded.data)));

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: chargePayment.pdfFileId })
      .from(chargePayment)
      .where(eq(chargePayment.id, paymentId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        entityType: "residence",
        entityId: loaded.residenceId,
        upload: { fileName: `${loaded.data.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(chargePayment)
      .set({ pdfFileId: stored.id })
      .where(eq(chargePayment.id, paymentId));
    return "stored";
  });
}
