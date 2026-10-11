/**
 * Electronic signature from the portal (CLAUDE.md §7 Electronic signature): the documents a
 * buyer or a tenant signs with a one-time code e-mailed to their account — a simple electronic
 * signature with its proof (Loi 15-04), not a qualified one.
 */
export const signableDocuments = ["schedule_amendment", "lease_inspection"] as const;
export type SignableDocument = (typeof signableDocuments)[number];

/** Minutes a code stays valid, tries per code, codes per document and hour. */
export const SIGNATURE_CODE_MINUTES = 10;
export const SIGNATURE_CODE_TRIES = 5;
export const SIGNATURE_CODES_PER_HOUR = 5;

/** « k•••@example.test »: the address a code went to, without giving it away. */
export function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}•••@${domain}`;
}
