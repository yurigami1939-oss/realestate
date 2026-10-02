"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { commissionRatesSchema, payCommissionSchema } from "./schemas";
import { payCommission, saveCommissionRates } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/commissions", "layout");
    revalidatePath("/[locale]/sales", "layout");
    return result;
  });
}

export const payCommissionAction = defineAction(
  { input: payCommissionSchema, permission: "commission:update" },
  (input, ctx) => mutation(() => payCommission(ctx, input)),
);
export const saveCommissionRatesAction = defineAction(
  { input: commissionRatesSchema, permission: "organization:update" },
  (input, ctx) => mutation(() => saveCommissionRates(ctx, input)),
);
