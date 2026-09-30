import "server-only";

import { eq } from "drizzle-orm";

import { quotation } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderQuotationPdf } from "@/pdf/quotation";
import { storeFile } from "@/server/files/service";

import { loadQuotationDocument } from "./queries";

/**
 * Job `pdf.quotation`: renders the quotation once and links the stored PDF. Idempotent: a
 * quotation that already has its PDF is skipped (retries, duplicate jobs).
 */
export async function renderAndStoreQuotationPdf(payload: {
  organizationId: string;
  quotationId: string;
}): Promise<"stored" | "skipped"> {
  const scope = { orgId: payload.organizationId };
  const doc = await withTenant(scope, (tx) =>
    loadQuotationDocument(tx, payload.organizationId, payload.quotationId),
  );
  if (!doc || doc.pdfFileId) return "skipped";

  // Rendering takes a moment: outside any transaction.
  const bytes = new Uint8Array(await renderQuotationPdf(doc));

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: quotation.pdfFileId })
      .from(quotation)
      .where(eq(quotation.id, payload.quotationId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: payload.organizationId, userId: null },
      {
        entityType: "quotation",
        entityId: payload.quotationId,
        upload: { fileName: `${doc.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(quotation)
      .set({ pdfFileId: stored.id })
      .where(eq(quotation.id, payload.quotationId));
    return "stored";
  });
}
