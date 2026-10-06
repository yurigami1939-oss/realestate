/** Isomorphic: the management reports (CLAUDE.md §7 Reports). */
import { addMonths, type CalendarDate } from "./dates";

/** Receivables by age: not due yet, days late, or waiting for a construction milestone. */
export const ageingBuckets = [
  "not_due",
  "d0_30",
  "d31_60",
  "d61_90",
  "d91_180",
  "over_180",
  "undated",
] as const;
export type AgeingBucket = (typeof ageingBuckets)[number];

const DAY_MS = 86_400_000;

/** The age of what remains on an installment as of `today` (due today = not late yet). */
export function ageingBucket(dueOn: CalendarDate | null, today: CalendarDate): AgeingBucket {
  if (dueOn === null) return "undated";
  if (dueOn >= today) return "not_due";
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / DAY_MS,
  );
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  if (days <= 180) return "d91_180";
  return "over_180";
}

/**
 * The months ("YYYY-MM") from the month of `from` to the month of `to` included, or `count`
 * months from `from` when `to` is null (at most 60).
 */
export function monthsOfPeriod(from: CalendarDate, to: CalendarDate | null, count = 12): string[] {
  const start = `${from.slice(0, 7)}-01`;
  const months: string[] = [];
  for (let i = 0; i < 60; i++) {
    const month = addMonths(start, i).slice(0, 7);
    if (to === null ? i >= count : month > to.slice(0, 7)) break;
    months.push(month);
  }
  return months;
}
