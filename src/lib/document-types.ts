/** Numbered document types and their prefixes (CLAUDE.md §7 Document numbering). */
export const documentTypes = [
  "receipt",
  "reservation",
  "sale_contract",
  "payment_call",
  "charge_call",
  "quotation",
  "charge_receipt",
] as const;

export type DocumentType = (typeof documentTypes)[number];

export const documentPrefixes: Record<DocumentType, string> = {
  receipt: "REC",
  reservation: "RES",
  sale_contract: "VSP",
  payment_call: "ADF",
  charge_call: "ADC",
  quotation: "DEV",
  charge_receipt: "RCH",
};

/** `REC-2026-000123` */
export function formatDocumentNumber(type: DocumentType, year: number, sequence: number): string {
  return `${documentPrefixes[type]}-${year}-${String(sequence).padStart(6, "0")}`;
}
