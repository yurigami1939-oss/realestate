/** Isomorphic: shared by the milestone and payment-plan editors and their actions. */
import { z } from "zod";

import { parsePercentToBasisPoints } from "@/lib/money";
import { FULL_SHARE_BP, planStepTriggers } from "@/lib/payment-plans";
import { constructionStages } from "@/lib/sales";
import {
  optionalDateText,
  optionalEnum,
  optionalIntText,
  optionalText,
  requiredText,
} from "@/lib/zod";

// ── Construction milestones (planning) ──────────────────────────────────────

export const milestoneFields = z.object({
  /** Existing milestone, or "" for a new one. */
  id: z.union([z.uuid(), z.literal("")]),
  name: requiredText(120),
  /** Construction stage, for the VSP limit check (CLAUDE.md §12). */
  stage: optionalEnum(constructionStages),
  plannedOn: optionalDateText(),
});

/** The whole ordered list of a project's milestones; missing ones are removed. */
export const saveMilestonesSchema = z.object({
  projectId: z.uuid(),
  milestones: z.array(milestoneFields).max(40),
});

// ── Payment plans ───────────────────────────────────────────────────────────

/** "20", "12,5" → basis points (0 < share ≤ 100 %). */
const shareText = () =>
  z.string().transform((v, ctx) => {
    const bp = parsePercentToBasisPoints(v);
    if (bp === null || bp <= 0n || bp > BigInt(FULL_SHARE_BP)) {
      ctx.addIssue({ code: "custom", message: "validation.percent" });
      return z.NEVER;
    }
    return Number(bp);
  });

export const planStepFields = z
  .object({
    label: requiredText(120),
    share: shareText(),
    trigger: z.enum(planStepTriggers),
    months: optionalIntText(0, 240),
    milestoneId: z.union([z.uuid(), z.literal("")]),
  })
  .superRefine((step, ctx) => {
    if (step.trigger === "months_after_signing" && step.months === null) {
      ctx.addIssue({ code: "custom", path: ["months"], message: "validation.required" });
    }
    if (step.trigger === "milestone" && step.milestoneId === "") {
      ctx.addIssue({ code: "custom", path: ["milestoneId"], message: "validation.required" });
    }
  })
  .transform((step) => ({
    label: step.label,
    shareBp: step.share,
    trigger: step.trigger,
    months: step.trigger === "months_after_signing" ? step.months : null,
    milestoneId: step.trigger === "milestone" ? step.milestoneId : null,
  }));

export const paymentPlanFields = z.object({
  name: requiredText(120),
  isDefault: z.boolean(),
  notes: optionalText(1000),
  steps: z
    .array(planStepFields)
    .min(1, "paymentPlans.errors.noSteps")
    .max(30)
    .refine((steps) => steps.reduce((sum, s) => sum + s.shareBp, 0) === FULL_SHARE_BP, {
      message: "paymentPlans.errors.total",
    }),
});

export const createPaymentPlanSchema = paymentPlanFields.extend({ projectId: z.uuid() });
export const updatePaymentPlanSchema = paymentPlanFields.extend({ planId: z.uuid() });
export const paymentPlanIdSchema = z.object({ planId: z.uuid() });
