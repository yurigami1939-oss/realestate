import "server-only";

import { and, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import { building, lease, leaseInspection, project, rentPayment, unit, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { formatDate } from "@/lib/dates";
import type { RentPaymentMethod } from "@/lib/rentals";
import { type ReceiptData, receiptHtml } from "@/pdf/receipt";
import { renderPdf } from "@/pdf/render";
import {
  type InspectionReportData,
  InspectionReportTemplate,
} from "@/pdf/templates/inspection-report";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

import { LEASE_ENTITY } from "./service";

const methodLabels: Record<RentPaymentMethod, { fr: string; ar: string }> = {
  cash: { fr: "Espèces", ar: "نقداً" },
  cheque: { fr: "Chèque", ar: "صك" },
  bank_transfer: { fr: "Virement bancaire", ar: "تحويل بنكي" },
  ccp: { fr: "Versement CCP", ar: "دفع عبر الحساب البريدي الجاري" },
};

/** Everything printed on a quittance (or a deposit receipt), resolved (null if unknown). */
export async function loadRentReceiptData(
  tx: Tx,
  orgId: string,
  paymentId: string,
): Promise<{ data: ReceiptData; pdfFileId: string | null; leaseId: string } | null> {
  const [row] = await tx
    .select({
      payment: rentPayment,
      leaseNumber: lease.number,
      unitCode: unit.code,
      projectName: project.name,
      cashier: user.name,
    })
    .from(rentPayment)
    .innerJoin(lease, eq(lease.id, rentPayment.leaseId))
    .innerJoin(unit, eq(unit.id, lease.unitId))
    .innerJoin(project, eq(project.id, lease.projectId))
    .innerJoin(user, eq(user.id, rentPayment.recordedBy))
    .where(eq(rentPayment.id, paymentId));
  if (!row) return null;
  const company = await loadCompanyLetterhead(tx, orgId);

  const p = row.payment;
  // Rent payments never use bank loans (checked by the table).
  const method = methodLabels[p.method === "bank_loan" ? "bank_transfer" : p.method];
  const details = (number: string) =>
    [p.reference ? `${number} ${p.reference}` : null, p.bank ? `(${p.bank})` : null]
      .filter(Boolean)
      .join(" ");
  const detailsFr = details("n°");
  const detailsAr = details("رقم");
  const periodsFr = p.allocation
    .map((a) => `du ${formatDate(a.fromOn)} au ${formatDate(a.toOn)}`)
    .join(", ");
  const periodsAr = p.allocation
    .map((a) => `من ${formatDate(a.fromOn)} إلى ${formatDate(a.toOn)}`)
    .join("، ");
  const where = {
    fr: `Bail ${row.leaseNumber} · ${row.projectName}, lot ${row.unitCode}`,
    ar: `عقد الإيجار ${row.leaseNumber} · ${row.projectName}، الوحدة ${row.unitCode}`,
  };
  const deposit = p.kind === "deposit";

  return {
    pdfFileId: p.pdfFileId,
    leaseId: p.leaseId,
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
      reference: deposit
        ? { fr: `Dépôt de garantie · ${where.fr}`, ar: `مبلغ الضمان · ${where.ar}` }
        : {
            fr: `Loyer ${periodsFr ? `${periodsFr} ` : ""}· ${where.fr}`,
            ar: `الإيجار ${periodsAr ? `${periodsAr} ` : ""}· ${where.ar}`,
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
      title: deposit
        ? { fr: "REÇU DE DÉPÔT DE GARANTIE", ar: "وصل استلام مبلغ الضمان" }
        : { fr: "QUITTANCE DE LOYER", ar: "وصل تسديد الإيجار" },
      party: { fr: "Le locataire", ar: "المستأجر" },
    },
  };
}

/** `pdf.document` (rent_receipt): rendered once, filed under its lease. */
export async function renderAndStoreRentReceipt(
  organizationId: string,
  paymentId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, (tx) =>
    loadRentReceiptData(tx, organizationId, paymentId),
  );
  if (!loaded || loaded.pdfFileId) return "skipped";
  const bytes = new Uint8Array(await renderPdf(receiptHtml(loaded.data)));
  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: rentPayment.pdfFileId })
      .from(rentPayment)
      .where(eq(rentPayment.id, paymentId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        entityType: LEASE_ENTITY,
        entityId: loaded.leaseId,
        upload: { fileName: `${loaded.data.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx.update(rentPayment).set({ pdfFileId: stored.id }).where(eq(rentPayment.id, paymentId));
    return "stored";
  });
}

/** Everything printed on an état des lieux (null if unknown). */
export async function loadInspectionData(
  tx: Tx,
  inspectionId: string,
): Promise<{ data: InspectionReportData; pdfFileId: string | null; leaseId: string } | null> {
  const [row] = await tx
    .select({
      inspection: leaseInspection,
      leaseNumber: lease.number,
      tenantName: lease.tenantName,
      tenantNameAr: lease.tenantNameAr,
      unitCode: unit.code,
      buildingName: building.name,
      projectName: project.name,
      address: project.address,
      commune: project.commune,
      wilaya: project.wilaya,
    })
    .from(leaseInspection)
    .innerJoin(lease, eq(lease.id, leaseInspection.leaseId))
    .innerJoin(unit, eq(unit.id, lease.unitId))
    .innerJoin(building, eq(building.id, unit.buildingId))
    .innerJoin(project, eq(project.id, lease.projectId))
    .where(eq(leaseInspection.id, inspectionId));
  if (!row) return null;
  const i = row.inspection;
  // At check-out, the condition of each element at check-in, for comparison.
  const [entry] =
    i.kind === "check_out"
      ? await tx
          .select({ items: leaseInspection.items })
          .from(leaseInspection)
          .where(and(eq(leaseInspection.leaseId, i.leaseId), eq(leaseInspection.kind, "check_in")))
      : [];
  return {
    pdfFileId: i.pdfFileId,
    leaseId: i.leaseId,
    data: {
      kind: i.kind,
      inspectedOn: i.inspectedOn,
      leaseNumber: row.leaseNumber,
      projectName: row.projectName,
      projectAddress: [row.address, row.commune, row.wilaya].filter(Boolean).join(", "),
      buildingName: row.buildingName,
      unitCode: row.unitCode,
      tenantName: row.tenantName,
      tenantNameAr: row.tenantNameAr,
      items: i.items,
      entry: entry ? Object.fromEntries(entry.items.map((e) => [e.element, e.condition])) : null,
      electricityMeter: i.electricityMeter,
      gasMeter: i.gasMeter,
      waterMeter: i.waterMeter,
      keysCount: i.keysCount,
      observations: i.observations,
    },
  };
}

export function inspectionHtml(data: InspectionReportData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(InspectionReportTemplate, { data, company }),
  )}`;
}

/** `pdf.document` (lease_inspection): rendered once, filed under its lease. */
export async function renderAndStoreInspection(
  organizationId: string,
  inspectionId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const report = await loadInspectionData(tx, inspectionId);
    if (!report || report.pdfFileId) return null;
    return { report, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const { report, company } = loaded;
  const bytes = new Uint8Array(await renderPdf(inspectionHtml(report.data, company)));
  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: leaseInspection.pdfFileId })
      .from(leaseInspection)
      .where(eq(leaseInspection.id, inspectionId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const name =
      report.data.kind === "check_in" ? "etat-des-lieux-entree" : "etat-des-lieux-sortie";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        entityType: LEASE_ENTITY,
        entityId: report.leaseId,
        upload: { fileName: `${report.data.leaseNumber}-${name}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(leaseInspection)
      .set({ pdfFileId: stored.id })
      .where(eq(leaseInspection.id, inspectionId));
    return "stored";
  });
}
