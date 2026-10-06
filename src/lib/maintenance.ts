/** Isomorphic: a residence's inspections, insurance and maintenance (CLAUDE.md §7 Residence). */
import { addDays, addMonths, type CalendarDate } from "./dates";

/** Insurance (a policy to renew), a regulatory inspection, or preventive maintenance. */
export const checkKinds = ["insurance", "inspection", "maintenance"] as const;
export type CheckKind = (typeof checkKinds)[number];

/** What is checked: lifts, fire safety (extinguishers, alarms), installations, the building. */
export const checkCategories = [
  "lift",
  "fire_safety",
  "electricity",
  "gas",
  "water_tank",
  "generator",
  "pest_control",
  "building",
  "other",
] as const;
export type CheckCategory = (typeof checkCategories)[number];

/** The outcome of a visit: compliant, with remarks to follow, or not compliant. */
export const checkResults = ["compliant", "remarks", "non_compliant"] as const;
export type CheckResult = (typeof checkResults)[number];

/** Frequencies offered in forms (months); none = a one-off deadline. */
export const checkFrequencies = [1, 3, 6, 12, 24, 36, 60] as const;

/** A deadline within this many days is coming (dashboard, list). */
export const CHECK_SOON_DAYS = 30;

export type CheckState = "overdue" | "due_soon" | "ok";

/** Late once its day is past, coming within `CHECK_SOON_DAYS`, else in order. */
export function checkState(nextDueOn: CalendarDate, today: CalendarDate): CheckState {
  if (nextDueOn < today) return "overdue";
  if (nextDueOn <= addDays(today, CHECK_SOON_DAYS)) return "due_soon";
  return "ok";
}

/** The next deadline after a visit: its day plus the frequency (none: no default). */
export function nextCheckDue(doneOn: CalendarDate, frequencyMonths: number | null) {
  return frequencyMonths ? addMonths(doneOn, frequencyMonths) : null;
}
