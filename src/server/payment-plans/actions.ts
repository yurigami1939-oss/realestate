"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  createPaymentPlanSchema,
  paymentPlanIdSchema,
  saveMilestonesSchema,
  updatePaymentPlanSchema,
} from "./schemas";
import { createPaymentPlan, deletePaymentPlan, saveMilestones, updatePaymentPlan } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/projects", "layout");
    revalidatePath("/[locale]/leads", "layout");
    return result;
  });
}

export const saveMilestonesAction = defineAction(
  { input: saveMilestonesSchema, permission: "project:update" },
  (input, ctx) => mutation(() => saveMilestones(ctx, input)),
);
export const createPaymentPlanAction = defineAction(
  { input: createPaymentPlanSchema, permission: "project:update" },
  (input, ctx) => mutation(() => createPaymentPlan(ctx, input)),
);
export const updatePaymentPlanAction = defineAction(
  { input: updatePaymentPlanSchema, permission: "project:update" },
  (input, ctx) => mutation(() => updatePaymentPlan(ctx, input)),
);
export const deletePaymentPlanAction = defineAction(
  { input: paymentPlanIdSchema, permission: "project:update" },
  (input, ctx) => mutation(() => deletePaymentPlan(ctx, input)),
);
