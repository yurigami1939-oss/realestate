import "server-only";

import type { JobPayloads, PdfDocumentKind } from "@/jobs/queues";
import { renderAndStoreNotice } from "@/server/announcements/documents";
import { renderAndStoreConvocation, renderAndStoreMinutes } from "@/server/assemblies/documents";
import { renderAndStoreCertificate } from "@/server/certificates/documents";
import {
  renderAndStoreChargeCall,
  renderAndStoreChargeReceipt,
  renderAndStoreChargeReminder,
} from "@/server/charges/documents";
import { renderAndStoreReminderLetter } from "@/server/collections/documents";
import {
  renderAndStoreHandoverPv,
  renderAndStoreHandoverRelease,
} from "@/server/handovers/documents";
import { renderAndStorePaymentCall } from "@/server/payment-calls/documents";
import { renderAndStoreReceipt } from "@/server/payments/documents";
import { renderAndStoreQuotationPdf } from "@/server/quotations/pdf";
import { renderAndStoreInspection, renderAndStoreRentReceipt } from "@/server/rentals/documents";
import { renderAndStoreScheduleAmendment } from "@/server/sales/amendment-documents";
import { renderAndStoreReservationSheet } from "@/server/sales/documents";

type Renderer = (orgId: string, id: string) => Promise<"stored" | "skipped">;

/** One renderer per document kind; each renders once and links the stored PDF. */
const renderers: Record<PdfDocumentKind, Renderer> = {
  quotation: (organizationId, quotationId) =>
    renderAndStoreQuotationPdf({ organizationId, quotationId }),
  reservation_sheet: renderAndStoreReservationSheet,
  receipt: renderAndStoreReceipt,
  payment_call: renderAndStorePaymentCall,
  reminder_letter: renderAndStoreReminderLetter,
  charge_call: renderAndStoreChargeCall,
  charge_receipt: renderAndStoreChargeReceipt,
  charge_reminder: renderAndStoreChargeReminder,
  assembly_convocation: renderAndStoreConvocation,
  assembly_minutes: renderAndStoreMinutes,
  announcement: renderAndStoreNotice,
  handover_pv: renderAndStoreHandoverPv,
  handover_release: renderAndStoreHandoverRelease,
  rent_receipt: renderAndStoreRentReceipt,
  lease_inspection: renderAndStoreInspection,
  certificate: renderAndStoreCertificate,
  schedule_amendment: renderAndStoreScheduleAmendment,
};

/** Job `pdf.document`: dispatches to the document's renderer (idempotent). */
export function renderDocument(payload: JobPayloads["pdf.document"]) {
  return renderers[payload.kind](payload.organizationId, payload.id);
}
