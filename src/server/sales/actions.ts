"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { cancelOption, placeOption } from "./options";
import { cancelOptionSchema, placeOptionSchema } from "./schemas";

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
