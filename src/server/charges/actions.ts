"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { approveBudget, saveBudget } from "./budgets";
import { cancelChargePeriod, issueChargePeriod } from "./calls";
import { createChargeCategory, deleteChargeCategory, updateChargeCategory } from "./categories";
import { issueChargeReminder } from "./collections";
import { requestChargeDocument } from "./document-requests";
import { cancelChargePayment, clearChargeCheque, recordChargePayment } from "./payments";
import {
  addRecoveryStep,
  cancelRepaymentPlan,
  closeRecovery,
  createRepaymentPlan,
  openRecovery,
} from "./recovery";
import { issueWorksCall } from "./works";
import {
  addRecoveryStepSchema,
  budgetIdSchema,
  cancelRepaymentPlanSchema,
  closeRecoverySchema,
  createRepaymentPlanSchema,
  openRecoverySchema,
  cancelChargePaymentSchema,
  cancelChargePeriodSchema,
  chargeCategoryIdSchema,
  clearChargeChequeSchema,
  createChargeCategorySchema,
  issueChargePeriodSchema,
  issueChargeReminderSchema,
  issueWorksCallSchema,
  recordChargePaymentSchema,
  requestChargeDocumentSchema,
  saveBudgetSchema,
  updateChargeCategorySchema,
} from "./schemas";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/residences", "layout");
    return result;
  });
}

export const createChargeCategoryAction = defineAction(
  { input: createChargeCategorySchema, permission: "charge:create" },
  (input, ctx) => mutation(() => createChargeCategory(ctx, input)),
);
export const updateChargeCategoryAction = defineAction(
  { input: updateChargeCategorySchema, permission: "charge:create" },
  (input, ctx) => mutation(() => updateChargeCategory(ctx, input)),
);
export const deleteChargeCategoryAction = defineAction(
  { input: chargeCategoryIdSchema, permission: "charge:create" },
  (input, ctx) => mutation(() => deleteChargeCategory(ctx, input.categoryId)),
);
export const saveBudgetAction = defineAction(
  { input: saveBudgetSchema, permission: "charge:create" },
  (input, ctx) => mutation(() => saveBudget(ctx, input)),
);
export const approveBudgetAction = defineAction(
  { input: budgetIdSchema, permission: "charge:create" },
  (input, ctx) => mutation(() => approveBudget(ctx, input.budgetId)),
);
export const issueChargePeriodAction = defineAction(
  { input: issueChargePeriodSchema, permission: "charge:create" },
  (input, ctx) => mutation(() => issueChargePeriod(ctx, input)),
);
export const issueWorksCallAction = defineAction(
  { input: issueWorksCallSchema, permission: "charge:create" },
  (input, ctx) => mutation(() => issueWorksCall(ctx, input)),
);
export const cancelChargePeriodAction = defineAction(
  { input: cancelChargePeriodSchema, permission: "charge:cancel" },
  (input, ctx) => mutation(() => cancelChargePeriod(ctx, input)),
);
export const requestChargeDocumentAction = defineAction(
  // The service checks charge:read, or assembly:read / announcement:read for their documents.
  { input: requestChargeDocumentSchema },
  (input, ctx) => mutation(() => requestChargeDocument(ctx, input)),
);
export const recordChargePaymentAction = defineAction(
  { input: recordChargePaymentSchema, permission: "payment:create" },
  (input, ctx) => mutation(() => recordChargePayment(ctx, input)),
);
export const cancelChargePaymentAction = defineAction(
  { input: cancelChargePaymentSchema, permission: "payment:cancel" },
  (input, ctx) => mutation(() => cancelChargePayment(ctx, input)),
);
export const clearChargeChequeAction = defineAction(
  { input: clearChargeChequeSchema, permission: "payment:create" },
  (input, ctx) => mutation(() => clearChargeCheque(ctx, input)),
);
export const issueChargeReminderAction = defineAction(
  { input: issueChargeReminderSchema, permission: "charge:remind" },
  (input, ctx) => mutation(() => issueChargeReminder(ctx, input)),
);

const remind = { permission: "charge:remind" } as const;
export const openRecoveryAction = defineAction(
  { input: openRecoverySchema, ...remind },
  (input, ctx) => mutation(() => openRecovery(ctx, input)),
);
export const addRecoveryStepAction = defineAction(
  { input: addRecoveryStepSchema, ...remind },
  (input, ctx) => mutation(() => addRecoveryStep(ctx, input)),
);
export const createRepaymentPlanAction = defineAction(
  { input: createRepaymentPlanSchema, ...remind },
  (input, ctx) => mutation(() => createRepaymentPlan(ctx, input)),
);
export const cancelRepaymentPlanAction = defineAction(
  { input: cancelRepaymentPlanSchema, ...remind },
  (input, ctx) => mutation(() => cancelRepaymentPlan(ctx, input)),
);
export const closeRecoveryAction = defineAction(
  { input: closeRecoverySchema, ...remind },
  (input, ctx) => mutation(() => closeRecovery(ctx, input)),
);
