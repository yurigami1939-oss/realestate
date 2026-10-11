/**
 * The organization's own wording on its documents (CLAUDE.md §7 Documents): a paragraph in
 * French and in Arabic printed in the « mentions de la société » block of each kind of document
 * issued afterwards (issued documents are never rendered again). Isomorphic.
 */

/** The documents that carry the organization's wording. */
export const documentTextKinds = [
  "quotation",
  "reservation_sheet",
  "receipt",
  "payment_call",
  "reminder_letter",
  "charge_call",
  "certificate",
] as const;
export type DocumentTextKind = (typeof documentTextKinds)[number];

export type DocumentText = { fr: string; ar: string };
export type DocumentTexts = Partial<Record<DocumentTextKind, DocumentText>>;

/** At most this many characters per language and document. */
export const MAX_DOCUMENT_TEXT = 1_000;

/** The kinds with some wording, the empty ones left out. */
export function storedDocumentTexts(texts: DocumentTexts): DocumentTexts {
  return Object.fromEntries(
    Object.entries(texts).filter(([, t]) => t && (t.fr.trim() !== "" || t.ar.trim() !== "")),
  ) as DocumentTexts;
}
