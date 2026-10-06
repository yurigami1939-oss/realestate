"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { decideDiscountSchema, discountRequestIdSchema, requestDiscountSchema } from "./schemas";
import { cancelDiscountRequest, decideDiscount, requestDiscount } from "./service";

/** Discount requests show on the lead sheet, the managers' list and the dashboard. */
function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    for (const path of ["/[locale]/leads", "/[locale]/sales", "/[locale]/dashboard"]) {
      revalidatePath(path, "layout");
    }
    return result;
  });
}

export const requestDiscountAction = defineAction(
  { input: requestDiscountSchema, permission: "discount:request" },
  (input, ctx) => mutation(() => requestDiscount(ctx, input)),
);
export const decideDiscountAction = defineAction(
  { input: decideDiscountSchema, permission: "discount:decide" },
  (input, ctx) => mutation(() => decideDiscount(ctx, input)),
);
export const cancelDiscountRequestAction = defineAction(
  { input: discountRequestIdSchema, permission: "lead:read" },
  (input, ctx) => mutation(() => cancelDiscountRequest(ctx, input)),
);
