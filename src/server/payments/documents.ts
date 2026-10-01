import "server-only";

import { asc, eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  buyer,
  payment,
  project,
  receipt,
  reservation,
  reservationBuyer,
  unit,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { formatDate } from "@/lib/dates";
import type { PaymentMethod } from "@/lib/sales";
import { type ReceiptData, receiptHtml } from "@/pdf/receipt";
import { renderPdf } from "@/pdf/render";
import { storeFile } from "@/server/files/service";
import { loadCompanyProfile } from "@/server/organizations/settings";

const methodLabels: Record<PaymentMethod, { fr: string; ar: string }> = {
  cash: { fr: "Espèces", ar: "نقداً" },
  cheque: { fr: "Chèque", ar: "صك" },
  bank_transfer: { fr: "Virement bancaire", ar: "تحويل بنكي" },
  ccp: { fr: "Versement CCP", ar: "دفع عبر الحساب البريدي الجاري" },
  bank_loan: { fr: "Déblocage de crédit bancaire", ar: "صرف قرض بنكي" },
};

/** Everything printed on a receipt, resolved from the database (null if unknown). */
export async function loadReceiptData(
  tx: Tx,
  orgId: string,
  receiptId: string,
): Promise<{ data: ReceiptData; pdfFileId: string | null } | null> {
  const [row] = await tx
    .select({
      receipt,
      payment,
      saleNumber: reservation.number,
      unitCode: unit.code,
      projectName: project.name,
      cashier: user.name,
    })
    .from(receipt)
    .innerJoin(payment, eq(payment.id, receipt.paymentId))
    .innerJoin(reservation, eq(reservation.id, payment.reservationId))
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .innerJoin(user, eq(user.id, receipt.issuedBy))
    .where(eq(receipt.id, receiptId));
  if (!row) return null;
  const [main] = await tx
    .select({ lastNameAr: buyer.lastNameAr, firstNameAr: buyer.firstNameAr })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(eq(reservationBuyer.reservationId, row.payment.reservationId))
    .orderBy(asc(reservationBuyer.position))
    .limit(1);
  const company = await loadCompanyProfile(tx, orgId);

  const p = row.payment;
  const method = methodLabels[p.method];
  const details = [p.reference ? `n° ${p.reference}` : null, p.bank ? `(${p.bank})` : null]
    .filter(Boolean)
    .join(" ");
  const settled = row.receipt.allocation.map((a) => a.label).join(", ");
  const arabicName = [main?.lastNameAr, main?.firstNameAr].filter(Boolean).join(" ");

  return {
    pdfFileId: row.receipt.pdfFileId,
    data: {
      number: row.receipt.number,
      issuedAt: row.receipt.issuedAt,
      organization: {
        legalName: company.legalName ?? company.name,
        address: [company.address, company.wilaya].filter(Boolean).join(", "),
        rcNumber: company.rcNumber ?? "",
        nif: company.nif ?? "",
        nis: company.nis ?? "",
        aiNumber: company.aiNumber ?? "",
      },
      payer: { fr: p.payerName, ar: arabicName || p.payerName },
      reference: {
        fr: `Réservation ${row.saleNumber} · ${row.projectName}, lot ${row.unitCode}${settled ? ` · ${settled}` : ""}`,
        ar: `الحجز ${row.saleNumber} · ${row.projectName}، الوحدة ${row.unitCode}`,
      },
      method: {
        fr: `${method.fr}${details ? ` ${details}` : ""} du ${formatDate(p.paidOn)}${
          p.method === "cheque" ? " — sous réserve d'encaissement" : ""
        }`,
        ar: `${method.ar}${details ? ` ${details}` : ""}${
          p.method === "cheque" ? " — مع التحفظ إلى حين التحصيل" : ""
        }`,
      },
      amount: p.amount,
      cashier: row.cashier,
    },
  };
}

/** `pdf.document` (receipt): rendered once, linked to the receipt. */
export async function renderAndStoreReceipt(
  organizationId: string,
  receiptId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, (tx) => loadReceiptData(tx, organizationId, receiptId));
  if (!loaded || loaded.pdfFileId) return "skipped";
  const bytes = new Uint8Array(await renderPdf(receiptHtml(loaded.data)));

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: receipt.pdfFileId, paymentId: receipt.paymentId })
      .from(receipt)
      .where(eq(receipt.id, receiptId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const [owner] = await tx
      .select({ reservationId: payment.reservationId })
      .from(payment)
      .where(eq(payment.id, current.paymentId));
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        // Receipts are filed under their sale: readers follow the sale's visibility.
        entityType: "reservation",
        entityId: owner?.reservationId ?? receiptId,
        upload: { fileName: `${loaded.data.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx.update(receipt).set({ pdfFileId: stored.id }).where(eq(receipt.id, receiptId));
    return "stored";
  });
}
