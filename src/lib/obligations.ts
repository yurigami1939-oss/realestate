/**
 * Isomorphic: the promoter's obligations under Loi 11-04 (CLAUDE.md §7 Promoter's
 * obligations) — the contractual delivery date and the late-delivery indemnity owed to the
 * buyer (display only), the warranties after delivery, and the project's regulatory file.
 */
import { addMonths, type CalendarDate } from "./dates";
import type { Centimes } from "./money";
import { latePenalty } from "./statement";

/** Documents of a project's regulatory file (dossier administratif). */
export const projectDocumentKinds = [
  "land_title",
  "building_permit",
  "subdivision_permit",
  "technical_control",
  "insurance",
  "fgcmpi",
  "conformity_certificate",
  "co_ownership_rules",
  "division_statement",
  "ten_year_insurance",
  "catnat_insurance",
  "other",
] as const;
export type ProjectDocumentKind = (typeof projectDocumentKinds)[number];

/** What a project selling on plans should hold (missing ones are flagged, never blocking). */
export const essentialProjectDocuments = [
  "land_title",
  "building_permit",
  "technical_control",
  "insurance",
  "fgcmpi",
] as const satisfies readonly ProjectDocumentKind[];

/** A document expiring within this many days is flagged. */
export const EXPIRY_WARNING_DAYS = 60;

export type DocumentValidity = "valid" | "expiring" | "expired" | "permanent";

const DAY_MS = 86_400_000;
const daysBetween = (from: CalendarDate, to: CalendarDate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** A document's validity today: expired (before today), expiring (within 60 days), valid. */
export function documentValidity(
  expiresOn: CalendarDate | null,
  today: CalendarDate,
): DocumentValidity {
  if (expiresOn === null) return "permanent";
  if (expiresOn < today) return "expired";
  return daysBetween(today, expiresOn) <= EXPIRY_WARNING_DAYS ? "expiring" : "valid";
}

/**
 * Days of delay of a delivery: from the contractual date to the handover PV (delivered), or to
 * today (not delivered yet); 0 when on time or without a contractual date.
 */
export function deliveryDelayDays(sale: {
  dueOn: CalendarDate | null;
  deliveredOn: CalendarDate | null;
  today: CalendarDate;
}): number {
  if (sale.dueOn === null) return 0;
  return Math.max(0, daysBetween(sale.dueOn, sale.deliveredOn ?? sale.today));
}

export type DeliveryPenaltyRules = { monthlyRateBp: number; capBp: number };

/**
 * Indemnity for late delivery owed to the buyer, as the company settings state it: price ×
 * monthly rate × days late / 30, half-up, capped at a share of the price. Shown, never booked;
 * 0 % (default) = off.
 */
export function deliveryPenalty(
  price: Centimes,
  daysLate: number,
  rules: DeliveryPenaltyRules,
): Centimes {
  return latePenalty(price, price, daysLate, {
    monthlyRateBp: rules.monthlyRateBp,
    graceDays: 0,
    capBp: rules.capBp,
  });
}

/**
 * Warranties running from the handover PV: parfait achèvement (one year), bon fonctionnement
 * of the equipment (two years) and décennale (ten years), shown to staff and buyers; their
 * legal scope is the contract's.
 */
export function warrantyEnds(deliveredOn: CalendarDate): {
  completion: CalendarDate;
  functioning: CalendarDate;
  tenYear: CalendarDate;
} {
  return {
    completion: addMonths(deliveredOn, 12),
    functioning: addMonths(deliveredOn, 24),
    tenYear: addMonths(deliveredOn, 120),
  };
}

/** Warranty a defect reported after the handover is claimed under (CLAUDE.md §7). */
export const warrantyKinds = ["completion", "functioning", "ten_year"] as const;
export type WarrantyKind = (typeof warrantyKinds)[number];

/** Claim states: open (to qualify), with the contractor, fixed, or rejected (closed). */
export const warrantyClaimStatuses = ["open", "assigned", "fixed", "rejected"] as const;
export type WarrantyClaimStatus = (typeof warrantyClaimStatuses)[number];

/** Warranties still running on a day (a claim reported after all of them is out of warranty). */
export function runningWarranties(deliveredOn: CalendarDate, on: CalendarDate): WarrantyKind[] {
  const ends = warrantyEnds(deliveredOn);
  return warrantyKinds.filter(
    (kind) =>
      on <=
      (kind === "completion"
        ? ends.completion
        : kind === "functioning"
          ? ends.functioning
          : ends.tenYear),
  );
}
