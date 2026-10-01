"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  addResidentSchema,
  createResidenceSchema,
  endResidentSchema,
  residenceIdSchema,
  saveSharesSchema,
  updateResidenceSchema,
} from "./schemas";
import {
  addResident,
  createResidence,
  distributeSharesByArea,
  endResident,
  importSaleBuyers,
  saveShares,
  updateResidence,
} from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/residences", "layout");
    return result;
  });
}

export const createResidenceAction = defineAction(
  { input: createResidenceSchema, permission: "residence:create" },
  (input, ctx) => mutation(() => createResidence(ctx, input)),
);
export const updateResidenceAction = defineAction(
  { input: updateResidenceSchema, permission: "residence:update" },
  (input, ctx) => mutation(() => updateResidence(ctx, input)),
);
export const saveSharesAction = defineAction(
  { input: saveSharesSchema, permission: "residence:update" },
  (input, ctx) => mutation(() => saveShares(ctx, input)),
);
export const distributeSharesByAreaAction = defineAction(
  { input: residenceIdSchema, permission: "residence:update" },
  (input, ctx) => mutation(() => distributeSharesByArea(ctx, input.residenceId)),
);
export const importSaleBuyersAction = defineAction(
  { input: residenceIdSchema, permission: "residence:update" },
  (input, ctx) => mutation(() => importSaleBuyers(ctx, input.residenceId)),
);
export const addResidentAction = defineAction(
  { input: addResidentSchema, permission: "residence:update" },
  (input, ctx) => mutation(() => addResident(ctx, input)),
);
export const endResidentAction = defineAction(
  { input: endResidentSchema, permission: "residence:update" },
  (input, ctx) => mutation(() => endResident(ctx, input)),
);
