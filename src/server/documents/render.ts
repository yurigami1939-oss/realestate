import "server-only";

import type { JobPayloads, PdfDocumentKind } from "@/jobs/queues";
import { renderAndStoreReminderLetter } from "@/server/collections/documents";
import { renderAndStorePaymentCall } from "@/server/payment-calls/documents";
import { renderAndStoreReceipt } from "@/server/payments/documents";
import { renderAndStoreQuotationPdf } from "@/server/quotations/pdf";
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
};

/** Job `pdf.document`: dispatches to the document's renderer (idempotent). */
export function renderDocument(payload: JobPayloads["pdf.document"]) {
  return renderers[payload.kind](payload.organizationId, payload.id);
}
