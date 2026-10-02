"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { cancelPaymentSchema, clearChequeSchema, recordPaymentSchema } from "./schemas";
import { cancelPayment, clearCheque, recordPayment } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/sales", "layout");
    revalidatePath("/[locale]/payments", "layout");
    return result;
  });
}

export const recordPaymentAction = defineAction(
  { input: recordPaymentSchema, permission: "payment:create" },
  (input, ctx) => mutation(() => recordPayment(ctx, input)),
);
export const cancelPaymentAction = defineAction(
  { input: cancelPaymentSchema, permission: "payment:cancel" },
  (input, ctx) => mutation(() => cancelPayment(ctx, input)),
);
export const clearChequeAction = defineAction(
  { input: clearChequeSchema, permission: "payment:create" },
  (input, ctx) => mutation(() => clearCheque(ctx, input)),
);
