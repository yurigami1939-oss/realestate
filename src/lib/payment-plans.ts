/**
 * Payment plans (CLAUDE.md §7, §12): a project template splits the price into steps, each due
 * at signing, N months after signing, or at a construction milestone. The simulator, quotations
 * and (module 3) real schedules all build their lines with `buildSchedule`. Isomorphic.
 */
import { addMonths, type CalendarDate } from "./dates";
import { allocate, type Centimes } from "./money";

export const planStepTriggers = ["signing", "months_after_signing", "milestone"] as const;
export type PlanStepTrigger = (typeof planStepTriggers)[number];

/** Shares are basis points of the price; a plan's steps sum to exactly 100 %. */
export const FULL_SHARE_BP = 10_000;

export type PlanStep = {
  label: string;
  shareBp: number;
  trigger: PlanStepTrigger;
  /** For `months_after_signing`. */
  months: number | null;
  /** For `milestone`. */
  milestoneId: string | null;
};

export type PlanMilestone = { id: string; name: string; plannedOn: CalendarDate | null };

export type ScheduleLine = {
  position: number;
  label: string;
  shareBp: number;
  amount: Centimes;
  trigger: PlanStepTrigger;
  /** Signing date, signing + N months, or the milestone's planned date (null if unknown). */
  dueOn: CalendarDate | null;
  milestoneName: string | null;
};

/**
 * Lines of a schedule: amounts from `allocate` (they always sum to the price, remainders to the
 * largest fractions), due dates from the signing date and the milestones' planned dates.
 */
export function buildSchedule(
  price: Centimes,
  steps: readonly PlanStep[],
  signingOn: CalendarDate,
  milestones: readonly PlanMilestone[],
): ScheduleLine[] {
  if (steps.length === 0) return [];
  const amounts =
    price === 0n
      ? steps.map(() => 0n)
      : allocate(
          price,
          steps.map((s) => s.shareBp),
        );
  return steps.map((step, index) => {
    const milestone =
      step.trigger === "milestone" ? milestones.find((m) => m.id === step.milestoneId) : undefined;
    const dueOn =
      step.trigger === "signing"
        ? signingOn
        : step.trigger === "months_after_signing"
          ? addMonths(signingOn, step.months ?? 0)
          : (milestone?.plannedOn ?? null);
    return {
      position: index + 1,
      label: step.label,
      shareBp: step.shareBp,
      amount: amounts[index] ?? 0n,
      trigger: step.trigger,
      dueOn,
      milestoneName: milestone?.name ?? null,
    };
  });
}

/** Sum of the shares; a valid plan has exactly FULL_SHARE_BP. */
export const totalShare = (steps: readonly Pick<PlanStep, "shareBp">[]) =>
  steps.reduce((sum, s) => sum + s.shareBp, 0);

/** "12,5 %" from basis points, French-style decimals (both locales use Latin digits). */
export function formatShare(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = Math.abs(bp % 100);
  return fraction === 0
    ? `${whole}\u00a0%`
    : `${whole},${String(fraction).padStart(2, "0").replace(/0$/, "")}\u00a0%`;
}

/** Net price after a discount, never below zero. */
export const netPrice = (listPrice: Centimes, discount: Centimes) =>
  discount >= listPrice ? 0n : listPrice - discount;
