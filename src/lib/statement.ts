/**
 * Statement of a sale (CLAUDE.md §7, §12): what is paid, due, overdue and late-penalized on
 * each installment. Allocation is derived, never stored: the total of the valid payments is
 * applied FIFO to the installments ordered by due date (unknown dates last), then position.
 * Isomorphic: used by services (payment checks), pages and documents.
 */
import type { CalendarDate } from "./dates";
import { sumCentimes, type Centimes } from "./money";

export type StatementInstallment = {
  position: number;
  label: string;
  amount: Centimes;
  /** Null for a milestone installment whose milestone is not validated yet. */
  dueOn: CalendarDate | null;
};

export type PenaltyRules = {
  /** Per month of delay, on the overdue amount; 0 = off. */
  monthlyRateBp: number;
  graceDays: number;
  /** Cap as a share of the installment amount. */
  capBp: number;
};

export type InstallmentState = "paid" | "overdue" | "due" | "upcoming" | "pending";

export type StatementLine<T extends StatementInstallment = StatementInstallment> = T & {
  paid: Centimes;
  remaining: Centimes;
  state: InstallmentState;
  /** Days past the due date (0 if not overdue). */
  daysLate: number;
  /** Computed late penalty (display only, never charged automatically). */
  penalty: Centimes;
};

export type Statement<T extends StatementInstallment = StatementInstallment> = {
  /** In allocation order (due date, then position). */
  lines: StatementLine<T>[];
  price: Centimes;
  paid: Centimes;
  remaining: Centimes;
  /** Remaining on installments due today or earlier. */
  due: Centimes;
  /** Remaining on installments due before today. */
  overdue: Centimes;
  /** Paid in advance on installments not due yet. */
  advance: Centimes;
  penalties: Centimes;
};

const DAY_MS = 86_400_000;

function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Orders installments for allocation: due date ascending, unknown dates last, then position. */
export function allocationOrder<T extends StatementInstallment>(installments: readonly T[]): T[] {
  return [...installments].sort((a, b) => {
    if (a.dueOn !== b.dueOn) {
      if (a.dueOn === null) return 1;
      if (b.dueOn === null) return -1;
      return a.dueOn < b.dueOn ? -1 : 1;
    }
    return a.position - b.position;
  });
}

/**
 * Late penalty of one overdue amount: remaining × monthly rate × (days late − grace) / 30,
 * rounded half-up to the centime, capped at `capBp` of the installment amount.
 */
export function latePenalty(
  remaining: Centimes,
  amount: Centimes,
  daysLate: number,
  rules: PenaltyRules,
): Centimes {
  const days = daysLate - rules.graceDays;
  if (rules.monthlyRateBp <= 0 || days <= 0 || remaining <= 0n) return 0n;
  const raw = (remaining * BigInt(rules.monthlyRateBp) * BigInt(days) + 150_000n) / 300_000n;
  const cap = (amount * BigInt(rules.capBp) + 5_000n) / 10_000n;
  return raw < cap ? raw : cap;
}

export function computeStatement<T extends StatementInstallment>(
  installments: readonly T[],
  paidTotal: Centimes,
  today: CalendarDate,
  rules: PenaltyRules,
): Statement<T> {
  let available = paidTotal;
  const lines = allocationOrder(installments).map((inst): StatementLine<T> => {
    const paid = available >= inst.amount ? inst.amount : available > 0n ? available : 0n;
    available -= paid;
    const remaining = inst.amount - paid;
    let state: InstallmentState;
    if (remaining === 0n) state = "paid";
    else if (inst.dueOn === null) state = "pending";
    else if (inst.dueOn < today) state = "overdue";
    else if (inst.dueOn === today) state = "due";
    else state = "upcoming";
    const daysLate = state === "overdue" && inst.dueOn ? daysBetween(inst.dueOn, today) : 0;
    return {
      ...inst,
      paid,
      remaining,
      state,
      daysLate,
      penalty: latePenalty(remaining, inst.amount, daysLate, rules),
    };
  });

  const price = sumCentimes(installments.map((i) => i.amount));
  const remainingOf = (states: InstallmentState[]) =>
    sumCentimes(lines.filter((l) => states.includes(l.state)).map((l) => l.remaining));
  const dueAmount = sumCentimes(
    lines.filter((l) => l.dueOn !== null && l.dueOn <= today).map((l) => l.amount),
  );
  const paid = paidTotal < price ? paidTotal : price;
  return {
    lines,
    price,
    paid,
    remaining: price - paid,
    due: remainingOf(["overdue", "due"]),
    overdue: remainingOf(["overdue"]),
    advance: paid > dueAmount ? paid - dueAmount : 0n,
    penalties: sumCentimes(lines.map((l) => l.penalty)),
  };
}
