import type { CalendarDate } from "./dates";

export type QuotationState = "issued" | "cancelled" | "expired";

/** Issued, cancelled, or expired: derived from the validity date and Algiers today, never stored. */
export function quotationState(
  q: { status: "issued" | "cancelled"; validUntil: CalendarDate },
  today: CalendarDate,
): QuotationState {
  if (q.status === "cancelled") return "cancelled";
  return q.validUntil < today ? "expired" : "issued";
}
