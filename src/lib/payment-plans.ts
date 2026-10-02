/**
 * Payment plans (CLAUDE.md §7, §12): a project template splits the price into steps, each due
 * at signing, N months after signing, or at a construction milestone. The simulator, quotations
 * and (module 3) real schedules all build their lines with `buildSchedule`. Isomorphic.
 */
import { addDays, addMonths, type CalendarDate } from "./dates";
import { allocate, type Centimes } from "./money";
import {
  type ConstructionStage,
  vspLimitStages,
  type VspLimitStage,
  type VspLimits,
} from "./sales";

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

export type VspWarning =
  | { kind: "over_limit"; stage: VspLimitStage; limitBp: number; cumulativeBp: number }
  /** Steps not tied to a classified construction stage (time-based, or milestone without stage). */
  | { kind: "unclassified"; shareBp: number };

const stageRank: Record<VspLimitStage | ConstructionStage, number> = {
  signing: 0,
  foundations: 1,
  structure: 2,
  completion: 3,
  handover: 4,
};

/**
 * Compares a schedule with the company's cumulative VSP limits (CLAUDE.md §12): warnings only,
 * nothing when no limit is configured.
 */
export function checkVspLimits(
  steps: readonly Pick<PlanStep, "shareBp" | "trigger" | "milestoneId">[],
  milestones: readonly { id: string; stage: ConstructionStage | null }[],
  limits: VspLimits,
): VspWarning[] {
  const configured = vspLimitStages.filter((stage) => limits[stage] !== undefined);
  if (configured.length === 0) return [];
  const ranked = steps.map((step) => {
    if (step.trigger === "signing") return { shareBp: step.shareBp, rank: 0 };
    const stage =
      step.trigger === "milestone"
        ? milestones.find((m) => m.id === step.milestoneId)?.stage
        : undefined;
    return { shareBp: step.shareBp, rank: stage ? stageRank[stage] : null };
  });
  const warnings: VspWarning[] = [];
  for (const stage of configured) {
    const limitBp = limits[stage] ?? 0;
    const cumulativeBp = ranked
      .filter((r) => r.rank !== null && r.rank <= stageRank[stage])
      .reduce((sum, r) => sum + r.shareBp, 0);
    if (cumulativeBp > limitBp) warnings.push({ kind: "over_limit", stage, limitBp, cumulativeBp });
  }
  const unclassified = ranked.filter((r) => r.rank === null).reduce((sum, r) => sum + r.shareBp, 0);
  if (unclassified > 0) warnings.push({ kind: "unclassified", shareBp: unclassified });
  return warnings;
}

/**
 * Due date of a milestone installment once the milestone is validated: validation + the
 * company's payment-call delay, never before the signing (CLAUDE.md §7).
 */
export function milestoneDueOn(
  validatedOn: CalendarDate,
  delayDays: number,
  reservedOn: CalendarDate,
): CalendarDate {
  const due = addDays(validatedOn, delayDays);
  return due < reservedOn ? reservedOn : due;
}
