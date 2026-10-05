import "server-only";

import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import { certificate } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import { type CertificateDocument, CertificateTemplate } from "@/pdf/templates/certificate";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

/** A certificate as printed (null if unknown). */
export async function loadCertificateDocument(
  tx: Tx,
  certificateId: string,
): Promise<{ doc: CertificateDocument; pdfFileId: string | null; reservationId: string } | null> {
  const [row] = await tx.select().from(certificate).where(eq(certificate.id, certificateId));
  if (!row) return null;
  return {
    pdfFileId: row.pdfFileId,
    reservationId: row.reservationId,
    doc: {
      kind: row.kind,
      number: row.number,
      issuedAt: row.issuedAt,
      addressee: row.addressee,
      fromPortal: row.fromPortal,
      data: row.data,
    },
  };
}

export function certificateHtml(doc: CertificateDocument, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(CertificateTemplate, { doc, company }),
  )}`;
}

/** `pdf.document` (certificate): rendered once, filed under its sale. */
export async function renderAndStoreCertificate(
  organizationId: string,
  certificateId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const found = await loadCertificateDocument(tx, certificateId);
    if (!found || found.pdfFileId) return null;
    return { found, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(await renderPdf(certificateHtml(loaded.found.doc, loaded.company)));

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: certificate.pdfFileId })
      .from(certificate)
      .where(eq(certificate.id, certificateId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        // Filed under the sale: readers follow the sale's visibility (and its buyers' portal).
        entityType: "reservation",
        entityId: loaded.found.reservationId,
        upload: { fileName: `${loaded.found.doc.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(certificate)
      .set({ pdfFileId: stored.id })
      .where(eq(certificate.id, certificateId));
    return "stored";
  });
}
