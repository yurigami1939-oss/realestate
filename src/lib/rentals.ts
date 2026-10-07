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
  /** A charges settlement's balance due from the tenant (not a rent period). */
  settlementYear?: number;
};

/** A yearly charges settlement: positive = due from the tenant, negative = a credit. */
export type ChargeSettlement = { year: number; balance: Centimes; dueOn: CalendarDate };

/** The charges provisions billed by the periods starting in a year. */
export function provisionsOfYear(periods: readonly RentPeriod[], year: number): Centimes {
  return periods
    .filter((p) => p.settlementYear === undefined && p.fromOn.startsWith(`${year}-`))
    .reduce((sum, p) => sum + p.charges, 0n);
}

/**
 * The lines of a rent account: the periods, then each settlement due from the tenant as a
 * line of its own; credits (settlements in the tenant's favour) are returned apart, to count
 * with the payments.
 */
export function rentAccountLines(
  periods: readonly RentPeriod[],
  settlements: readonly ChargeSettlement[] = [],
): { lines: RentPeriod[]; credit: Centimes } {
  const lines = [...periods];
  let credit = 0n;
  for (const settlement of [...settlements].sort((a, b) => a.year - b.year)) {
    if (settlement.balance > 0n) {
      lines.push({
        position: lines.length + 1,
        fromOn: `${settlement.year}-01-01`,
        toOn: `${settlement.year}-12-31`,
        months: 0,
        rent: 0n,
        charges: settlement.balance,
        amount: settlement.balance,
        dueOn: settlement.dueOn,
        settlementYear: settlement.year,
      });
    } else {
      credit += -settlement.balance;
    }
  }
  return { lines, credit };
}

/** A rent revision: from `effectiveOn` (a period's first day) on, the new monthly amounts. */
export type RentRevision = {
  effectiveOn: CalendarDate;
  monthlyRent: Centimes;
  monthlyCharges: Centimes;
};

/** The monthly amounts in force on a day: the latest revision effective by then, else the lease's. */
export function rentOn(
  terms: { monthlyRent: Centimes; monthlyCharges: Centimes; revisions?: readonly RentRevision[] },
  day: CalendarDate,
): { monthlyRent: Centimes; monthlyCharges: Centimes } {
  let current = { monthlyRent: terms.monthlyRent, monthlyCharges: terms.monthlyCharges };
  for (const revision of [...(terms.revisions ?? [])].sort((a, b) =>
    a.effectiveOn < b.effectiveOn ? -1 : 1,
  )) {
    if (revision.effectiveOn > day) break;
    current = { monthlyRent: revision.monthlyRent, monthlyCharges: revision.monthlyCharges };
  }
  return current;
}

/**
 * Rent periods of a lease: from its start, `frequency` months each (the last one shorter when
 * the duration is not a multiple), each due on its first day for its months of rent and
 * charges — at the amounts in force on that day (`revisions`). A lease ended early keeps only
 * the periods that started by its last day.
 */
export function buildRentPeriods(input: {
  startOn: CalendarDate;
  durationMonths: number;
  frequency: RentFrequency;
  monthlyRent: Centimes;
  monthlyCharges: Centimes;
  endedOn?: CalendarDate | null;
  revisions?: readonly RentRevision[];
}): RentPeriod[] {
  const step = monthsPerPeriod[input.frequency];
  const periods: RentPeriod[] = [];
  for (let first = 0; first < input.durationMonths; first += step) {
    const months = Math.min(step, input.durationMonths - first);
    const fromOn = addMonths(input.startOn, first);
    if (input.endedOn && fromOn > input.endedOn) break;
    const inForce = rentOn(input, fromOn);
    const rent = inForce.monthlyRent * BigInt(months);
    const charges = inForce.monthlyCharges * BigInt(months);
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
