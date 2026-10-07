/** Isomorphic: shared by the charge forms and their actions. */
import { z } from "zod";

import { MAX_PLAN_MONTHS, recoveryStepKinds } from "@/lib/recovery";
import {
  chargePaymentMethods,
  type DistributionKey,
  distributionKeys,
  distributionWeightings,
} from "@/lib/residences";
import {
  dateText,
  intText,
  moneyText,
  optionalMoneyText,
  optionalText,
  requiredText,
} from "@/lib/zod";

const categoryFields = {
  name: requiredText(80),
  nameAr: optionalText(80),
  key: z.enum(distributionKeys),
  weighting: z.enum(distributionWeightings),
  /** Building of a `per_building` key ("" when none). */
  buildingId: z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
  /** Units of a `custom` key. */
  unitIds: z.array(z.uuid()).max(2000),
};

/** A `per_building` key names its building, a `custom` key lists at least one unit. */
function keyTargets(
  v: { key: DistributionKey; buildingId: string | null; unitIds: string[] },
  ctx: z.RefinementCtx,
) {
  if (v.key === "per_building" && v.buildingId === null) {
    ctx.addIssue({ code: "custom", path: ["buildingId"], message: "validation.required" });
  }
  if (v.key === "custom" && v.unitIds.length === 0) {
    ctx.addIssue({ code: "custom", path: ["unitIds"], message: "charges.errors.noUnitsSelected" });
  }
}

export const createChargeCategorySchema = z
  .object({ residenceId: z.uuid(), ...categoryFields })
  .superRefine(keyTargets);
export const updateChargeCategorySchema = z
  .object({ categoryId: z.uuid(), ...categoryFields })
  .superRefine(keyTargets);
export const chargeCategoryIdSchema = z.object({ categoryId: z.uuid() });

/** Draft budget of a year: one annual amount per category (empty = nothing budgeted). */
export const saveBudgetSchema = z.object({
  residenceId: z.uuid(),
  year: intText(2000, 2100),
  lines: z.array(z.object({ categoryId: z.uuid(), amount: optionalMoneyText() })).max(200),
  notes: optionalText(1000),
});
export const budgetIdSchema = z.object({ budgetId: z.uuid() });

/**
 * Charge calls of one period of an approved budget. The form sends the period as
 * "budgetId:index"; the issue date is not in the future and the due date not before it.
 */
export const issueChargePeriodSchema = z.object({
  period: z
    .string()
    .regex(/^[0-9a-f-]{36}:\d{1,2}$/i, "validation.required")
    .transform((v) => {
      const [budgetId = "", index = "0"] = v.split(":");
      return { budgetId, periodIndex: Number(index) };
    }),
  issuedOn: dateText(),
  dueOn: dateText(),
});

/**
 * An exceptional call (works voted by the assembly): what it pays for, the category whose key
 * splits it, the amount, the issue and due days, and the resolution that voted it (optional).
 */
export const issueWorksCallSchema = z.object({
  residenceId: z.uuid(),
  title: requiredText(160),
  titleAr: optionalText(160),
  categoryId: z.uuid(),
  amount: moneyText().refine((v) => v > 0n, "validation.amount"),
  issuedOn: dateText(),
  dueOn: dateText(),
  resolutionId: z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
});

/** Voids the calls of a period (wrong budget, wrong co-owners…); it can then be issued again. */
export const cancelChargePeriodSchema = z.object({
  periodId: z.uuid(),
  reason: requiredText(300),
});

/** Residence documents rendered by the worker. */
export const chargeDocumentKinds = [
  "charge_call",
  "charge_receipt",
  "charge_reminder",
  "assembly_convocation",
  "assembly_minutes",
  "announcement",
] as const;
export const requestChargeDocumentSchema = z.object({
  kind: z.enum(chargeDocumentKinds),
  id: z.uuid(),
});

/** Charges paid for a unit; a receipt RCH- is issued with it. Cheques need number and bank. */
export const recordChargePaymentSchema = z
  .object({
    residenceId: z.uuid(),
    unitId: z.uuid(),
    amount: moneyText().refine((v) => v > 0n, "validation.amount"),
    method: z.enum(chargePaymentMethods),
    /** Day the money or cheque was received (not in the future). */
    paidOn: dateText(),
    reference: optionalText(60),
    bank: optionalText(80),
    payerName: requiredText(160),
    notes: optionalText(500),
    /** The cash desk or account it lands on; empty = the method's default account. */
    accountId: z.uuid().or(z.literal("")).optional(),
  })
  .refine((v) => v.method !== "cheque" || (v.reference !== null && v.bank !== null), {
    path: ["reference"],
    message: "payments.errors.chequeDetails",
  });

export const cancelChargePaymentSchema = z.object({
  paymentId: z.uuid(),
  reason: requiredText(300),
});

export const clearChargeChequeSchema = z.object({
  paymentId: z.uuid(),
  clearedOn: dateText(),
});

/** Reminder letter for a unit's overdue charges, with the date asked for payment. */
export const issueChargeReminderSchema = z.object({
  residenceId: z.uuid(),
  unitId: z.uuid(),
  payBy: dateText(),
});

/** A recovery file opened on a unit with overdue charges. */
export const openRecoverySchema = z.object({ residenceId: z.uuid(), unitId: z.uuid() });

/** A step of a recovery file, dated (not in the future), with a note. */
export const addRecoveryStepSchema = z.object({
  recoveryId: z.uuid(),
  kind: z.enum(recoveryStepKinds),
  doneOn: dateText(),
  note: optionalText(500),
});

/** Échéancier d'apurement: the amount, the number of monthly parts and the first due day. */
export const createRepaymentPlanSchema = z.object({
  recoveryId: z.uuid(),
  total: moneyText().refine((v) => v > 0n, "validation.amount"),
  months: intText(1, MAX_PLAN_MONTHS),
  firstDueOn: dateText(),
});

export const cancelRepaymentPlanSchema = z.object({ planId: z.uuid(), reason: requiredText(300) });

export const closeRecoverySchema = z.object({ recoveryId: z.uuid(), reason: requiredText(300) });

/** A meter index in m³ ("1 234,567"); blank = not read. Kept as a decimal string. */
const meterText = () =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const normalized = value.replace(/\s/g, "").replace(",", ".");
      if (!/^\d{1,9}(\.\d{1,3})?$/.test(normalized)) {
        ctx.addIssue({ code: "custom", message: "charges.meters.errors.reading" });
        return z.NEVER;
      }
      return normalized;
    });

/** A campaign of water meter readings on a day (each unit read, or left blank). */
export const saveMeterReadingsSchema = z.object({
  residenceId: z.uuid(),
  readOn: dateText(),
  readings: z.array(z.object({ unitId: z.uuid(), reading: meterText() })).max(500),
});

export const deleteMeterReadingSchema = z.object({ readingId: z.uuid() });
