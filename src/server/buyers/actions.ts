"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { createBuyerSchema, setBuyerDocumentSchema, updateBuyerSchema } from "./schemas";
import { createBuyer, setBuyerDocument, updateBuyer } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/buyers", "layout");
    revalidatePath("/[locale]/leads", "layout");
    return result;
  });
}

export const createBuyerAction = defineAction(
  { input: createBuyerSchema, permission: "buyer:create" },
  (input, ctx) => mutation(() => createBuyer(ctx, input)),
);
export const updateBuyerAction = defineAction(
  { input: updateBuyerSchema, permission: "buyer:update" },
  (input, ctx) => mutation(() => updateBuyer(ctx, input)),
);
export const setBuyerDocumentAction = defineAction(
  { input: setBuyerDocumentSchema, permission: "buyer:update" },
  (input, ctx) => mutation(() => setBuyerDocument(ctx, input)),
);
