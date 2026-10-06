/**
 * Isomorphic: the costs of a project (CLAUDE.md §7 Construction costs) — budget by category,
 * contractors' contracts and progress invoices with their retention, margin and cash-flow
 * forecast.
 */
import { addMonths, type CalendarDate } from "./dates";
import { allocate, applyRate, type Centimes } from "./money";

/** What an operation spends on: land, studies, works, utility networks (VRD), fees, finance… */
export const costCategories = [
  "land",
  "studies",
  "works",
  "networks",
  "fees",
  "financial",
  "marketing",
  "other",
] as const;
export type CostCategory = (typeof costCategories)[number];

/** Methods a contractor is paid with (no card, no bank loan). */
export const costPaymentMethods = ["bank_transfer", "cheque", "cash", "ccp"] as const;

/**
 * A contract's state: `active`, then réception provisoire (`provisional`), réception
 * définitive (`final`, the retention can be released); `terminated` (résilié).
 */
export const worksContractStates = ["active", "provisional", "final", "terminated"] as const;
export type WorksContractState = (typeof worksContractStates)[number];

/** Retention of guarantee by default (5 %), in basis points. */
export const DEFAULT_RETENTION_BP = 500;

/** A progress invoice's retention and net payable, from its gross amount. */
export function invoiceSplit(gross: Centimes, retentionBp: number) {
  const retention = applyRate(gross, retentionBp);
  return { retention, net: gross - retention };
}

/** A month of the cash-flow forecast: "YYYY-MM". */
export type MonthKey = string;

export const monthOf = (day: CalendarDate): MonthKey => day.slice(0, 7);

/** The `count` months from the month of `from`. */
export function nextMonths(from: CalendarDate, count: number): MonthKey[] {
  const start = `${monthOf(from)}-01`;
  return Array.from({ length: count }, (_, i) => monthOf(addMonths(start, i)));
}

/**
 * Spreads what remains to invoice on a contract evenly over the months from `from` to its
 * planned end (that month alone when the end is past or unknown); parts sum exactly.
 */
export function spreadRemaining(
  remaining: Centimes,
  from: CalendarDate,
  plannedEndOn: CalendarDate | null,
): Map<MonthKey, Centimes> {
  const result = new Map<MonthKey, Centimes>();
  if (remaining <= 0n) return result;
  const months =
    plannedEndOn && monthOf(plannedEndOn) > monthOf(from)
      ? nextMonths(from, monthsBetween(from, plannedEndOn) + 1)
      : [monthOf(from)];
  const parts = allocate(
    remaining,
    months.map(() => 1),
  );
  months.forEach((m, i) => result.set(m, parts[i] ?? 0n));
  return result;
}

function monthsBetween(from: CalendarDate, to: CalendarDate): number {
  return (
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(to.slice(5, 7)) -
    Number(from.slice(5, 7))
  );
}

/**
 * Margin of an operation: expected revenue (sales signed + unsold stock at its list price)
 * against the forecast cost (per category, the larger of the budget and what is committed).
 */
export function projectMargin(input: {
  signed: Centimes;
  stock: Centimes;
  budget: Record<string, Centimes>;
  committed: Record<string, Centimes>;
}) {
  const revenue = input.signed + input.stock;
  const categories = new Set([...Object.keys(input.budget), ...Object.keys(input.committed)]);
  let cost = 0n;
  for (const c of categories) {
    const budget = input.budget[c] ?? 0n;
    const committed = input.committed[c] ?? 0n;
    cost += budget > committed ? budget : committed;
  }
  const margin = revenue - cost;
  /** Basis points of the revenue (null without revenue). */
  const rateBp = revenue > 0n ? Number((margin * 10_000n) / revenue) : null;
  return { revenue, cost, margin, rateBp };
}
