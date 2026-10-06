"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { clearChequeDeposit, createChequeDeposit } from "./deposits";
import { clearChequeDepositSchema, createChequeDepositSchema } from "./schemas";

/** Slips change the treasury pages and the cheques shown on sales, residences and leases. */
function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    for (const path of [
      "/[locale]/treasury",
      "/[locale]/sales",
      "/[locale]/residences",
      "/[locale]/rentals",
    ]) {
      revalidatePath(path, "layout");
    }
    return result;
  });
}

export const createChequeDepositAction = defineAction(
  { input: createChequeDepositSchema, permission: "treasury:count" },
  (input, ctx) => mutation(() => createChequeDeposit(ctx, input)),
);
export const clearChequeDepositAction = defineAction(
  { input: clearChequeDepositSchema, permission: "payment:create" },
  (input, ctx) => mutation(() => clearChequeDeposit(ctx, input)),
);
