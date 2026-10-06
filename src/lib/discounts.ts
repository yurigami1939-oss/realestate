/**
 * Discount requests (CLAUDE.md §7 Reservations and VSP): a commercial asks a manager for a
 * discount on a unit for one of their leads; once approved, it can be granted on that lead's
 * quotations and reservation of the unit, up to the approved amount, for a limited time.
 * Isomorphic.
 */
import type { CalendarDate } from "./dates";

export const discountRequestStatuses = ["pending", "approved", "rejected", "cancelled"] as const;
export type DiscountRequestStatus = (typeof discountRequestStatuses)[number];

/** An approved discount can be used this many days after the decision. */
export const DISCOUNT_APPROVAL_DAYS = 30;

/** Shown state: an approved request past its last day is `expired` (derived, never stored). */
export const discountRequestStates = [...discountRequestStatuses, "expired"] as const;
export type DiscountRequestState = (typeof discountRequestStates)[number];

export function discountRequestState(
  request: { status: DiscountRequestStatus; validUntil: CalendarDate | null },
  today: CalendarDate,
): DiscountRequestState {
  if (request.status === "approved" && request.validUntil !== null && request.validUntil < today) {
    return "expired";
  }
  return request.status;
}
