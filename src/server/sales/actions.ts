"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { cancelOption, placeOption } from "./options";
import { createReservation, recordSale, updateReservationContract } from "./reservations";
import {
  cancelOptionSchema,
  createReservationSchema,
  placeOptionSchema,
  recordSaleSchema,
  reservationContractSchema,
} from "./schemas";

/** Sales touch units, leads, buyers and sales pages. */
function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    for (const path of [
      "/[locale]/projects",
      "/[locale]/leads",
      "/[locale]/buyers",
      "/[locale]/sales",
    ]) {
      revalidatePath(path, "layout");
    }
    return result;
  });
}

export const placeOptionAction = defineAction(
  { input: placeOptionSchema, permission: "sale:create" },
  (input, ctx) => mutation(() => placeOption(ctx, input)),
);
export const cancelOptionAction = defineAction(
  { input: cancelOptionSchema, permission: "sale:create" },
  (input, ctx) => mutation(() => cancelOption(ctx, input)),
);
export const createReservationAction = defineAction(
  { input: createReservationSchema, permission: "sale:create" },
  (input, ctx) => mutation(() => createReservation(ctx, input)),
);
export const updateReservationContractAction = defineAction(
  { input: reservationContractSchema, permission: "sale:update" },
  (input, ctx) => mutation(() => updateReservationContract(ctx, input)),
);
export const recordSaleAction = defineAction(
  { input: recordSaleSchema, permission: "sale:sign" },
  (input, ctx) => mutation(() => recordSale(ctx, input)),
);
