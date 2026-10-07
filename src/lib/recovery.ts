/**
 * Isomorphic: recovery of a unit's charge arrears (CLAUDE.md §7 Residence charges) — the steps
 * of the file and the repayment plan (échéancier d'apurement).
 */
import { addMonths, type CalendarDate } from "./dates";
import { allocate, type Centimes } from "./money";

/**
 * What was done: a reminder or a formal notice sent, a bailiff's summons (sommation), the
 * court seized (injonction de payer), a judgment, an agreement with the co-owner, or a note.
 */
export const recoveryStepKinds = [
  "reminder",
  "formal_notice",
  "bailiff",
  "court",
  "judgment",
  "agreement",
  "note",
] as const;
export type RecoveryStepKind = (typeof recoveryStepKinds)[number];

/** A repayment plan spreads over 1 to 24 months. */
export const MAX_PLAN_MONTHS = 24;

export type PlanLine = { dueOn: CalendarDate; amount: Centimes };

/** Equal monthly parts (the first ones a centime more when it does not divide), from a day on. */
export function planLines(total: Centimes, months: number, firstDueOn: CalendarDate): PlanLine[] {
  const parts = allocate(
    total,
    Array.from({ length: months }, () => 1),
  );
  return parts.map((amount, index) => ({ dueOn: addMonths(firstDueOn, index), amount }));
}

/**
 * Where a plan stands today: what its installments ask so far against what the unit paid since
 * the plan (payments go to the oldest calls first, so they settle the arrears).
 */
export function planProgress(lines: readonly PlanLine[], paidSince: Centimes, today: CalendarDate) {
  const total = lines.reduce((sum, l) => sum + l.amount, 0n);
  const due = lines.filter((l) => l.dueOn <= today).reduce((sum, l) => sum + l.amount, 0n);
  const paid = paidSince < 0n ? 0n : paidSince > total ? total : paidSince;
  return {
    total,
    due,
    paid,
    late: due > paid ? due - paid : 0n,
    done: paid >= total,
  };
}
