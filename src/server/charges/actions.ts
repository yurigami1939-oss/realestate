"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { approveBudget, saveBudget } from "./budgets";
import { createChargeCategory, deleteChargeCategory, updateChargeCategory } from "./categories";
import {
  budgetIdSchema,
  chargeCategoryIdSchema,
  createChargeCategorySchema,
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
