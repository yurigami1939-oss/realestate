/**
 * Rentals vocabulary (module 5, CLAUDE.md §6–§7, §12) and the rent schedule of a lease.
 * Isomorphic: shared by the Drizzle schema, Zod schemas, services and UI.
 */
import { addDays, addMonths, type CalendarDate } from "./dates";
import type { Centimes } from "./money";

/** Bail d'habitation / bail commercial (shop, office). */
export const leaseKinds = ["residential", "commercial"] as const;
export type LeaseKind = (typeof leaseKinds)[number];

/** A lease is the unit's current contract until it ends (moving out, or replaced by its renewal). */
export const leaseStatuses = ["active", "ended"] as const;
export type LeaseStatus = (typeof leaseStatuses)[number];

/** How often the rent is paid, always in advance at the start of each period. */
export const rentFrequencies = ["monthly", "quarterly", "half_yearly", "yearly"] as const;
export type RentFrequency = (typeof rentFrequencies)[number];

export const monthsPerPeriod: Record<RentFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

/** A receipt is a quittance de loyer, or the receipt of the security deposit. */
export const rentPaymentKinds = ["rent", "deposit"] as const;
export type RentPaymentKind = (typeof rentPaymentKinds)[number];

/** How a tenant pays (the sales methods without bank loan disbursements). */
export const rentPaymentMethods = ["cash", "cheque", "bank_transfer", "ccp"] as const;
export type RentPaymentMethod = (typeof rentPaymentMethods)[number];

/** État des lieux d'entrée / de sortie. */
export const inspectionKinds = ["check_in", "check_out"] as const;
export type InspectionKind = (typeof inspectionKinds)[number];

export const inspectionConditions = ["good", "fair", "poor"] as const;
export type InspectionCondition = (typeof inspectionConditions)[number];

/** Longest lease the app schedules (10 years). */
export const MAX_LEASE_MONTHS = 120;

/** Last day of a lease of `durationMonths` from `startOn`. */
export const leaseEndOn = (startOn: CalendarDate, durationMonths: number): CalendarDate =>
  addDays(addMonths(startOn, durationMonths), -1);

export type RentPeriod = {
  position: number;
  fromOn: CalendarDate;
  toOn: CalendarDate;
  months: number;
  rent: Centimes;
  charges: Centimes;
  amount: Centimes;
  /** Rent is paid in advance: due on the first day of its period. */
  dueOn: CalendarDate;
};

/**
 * Rent periods of a lease: from its start, `frequency` months each (the last one shorter when
 * the duration is not a multiple), each due on its first day for its months of rent and
 * charges. A lease ended early keeps only the periods that started by its last day.
 */
export function buildRentPeriods(input: {
  startOn: CalendarDate;
  durationMonths: number;
  frequency: RentFrequency;
  monthlyRent: Centimes;
  monthlyCharges: Centimes;
  endedOn?: CalendarDate | null;
}): RentPeriod[] {
  const step = monthsPerPeriod[input.frequency];
  const periods: RentPeriod[] = [];
  for (let first = 0; first < input.durationMonths; first += step) {
    const months = Math.min(step, input.durationMonths - first);
    const fromOn = addMonths(input.startOn, first);
    if (input.endedOn && fromOn > input.endedOn) break;
    const rent = input.monthlyRent * BigInt(months);
    const charges = input.monthlyCharges * BigInt(months);
    periods.push({
      position: periods.length + 1,
      fromOn,
      toOn: addDays(addMonths(input.startOn, first + months), -1),
      months,
      rent,
      charges,
      amount: rent + charges,
      dueOn: fromOn,
    });
  }
  return periods;
}

/**
 * Where a lease stands (derived): `ended`; `upcoming` (signed, not started); `expired` (still
 * the unit's contract after its last day: end it or renew it); `ending` (last day within
 * `ENDING_SOON_DAYS`); `running`.
 */
export const leaseStates = ["upcoming", "running", "ending", "expired", "ended"] as const;
export type LeaseState = (typeof leaseStates)[number];

/** A lease is flagged « ending soon » this many days before its last day. */
export const ENDING_SOON_DAYS = 60;

export function leaseState(
  lease: { status: LeaseStatus; startOn: CalendarDate; endOn: CalendarDate },
  today: CalendarDate,
): LeaseState {
  if (lease.status === "ended") return "ended";
  if (lease.startOn > today) return "upcoming";
  if (lease.endOn < today) return "expired";
  if (lease.endOn <= addDays(today, ENDING_SOON_DAYS)) return "ending";
  return "running";
}
