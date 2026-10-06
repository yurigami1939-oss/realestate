"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { checkIdSchema, createCheckSchema, recordVisitSchema, updateCheckSchema } from "./schemas";
import { archiveCheck, createCheck, recordVisit, updateCheck } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/residences", "layout");
    revalidatePath("/[locale]/dashboard", "page");
    return result;
  });
}

const rights = { permission: "residence:update" } as const;

export const createCheckAction = defineAction(
  { input: createCheckSchema, ...rights },
  (input, ctx) => mutation(() => createCheck(ctx, input)),
);
export const updateCheckAction = defineAction(
  { input: updateCheckSchema, ...rights },
  (input, ctx) => mutation(() => updateCheck(ctx, input)),
);
export const archiveCheckAction = defineAction({ input: checkIdSchema, ...rights }, (input, ctx) =>
  mutation(() => archiveCheck(ctx, input)),
);
export const recordVisitAction = defineAction(
  { input: recordVisitSchema, ...rights },
  (input, ctx) => mutation(() => recordVisit(ctx, input)),
);
