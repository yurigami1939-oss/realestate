"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  createReportSchema,
  reportIdSchema,
  reportPhotoSchema,
  updateReportSchema,
} from "./schemas";
import {
  createConstructionReport,
  deleteConstructionReport,
  removeReportPhoto,
  updateConstructionReport,
} from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/construction", "layout");
    return result;
  });
}

export const createReportAction = defineAction(
  { input: createReportSchema, permission: "construction:update" },
  (input, ctx) => mutation(() => createConstructionReport(ctx, input)),
);
export const updateReportAction = defineAction(
  { input: updateReportSchema, permission: "construction:update" },
  (input, ctx) => mutation(() => updateConstructionReport(ctx, input)),
);
export const deleteReportAction = defineAction(
  { input: reportIdSchema, permission: "construction:update" },
  (input, ctx) => mutation(() => deleteConstructionReport(ctx, input.reportId)),
);
export const removeReportPhotoAction = defineAction(
  { input: reportPhotoSchema, permission: "construction:update" },
  (input, ctx) => mutation(() => removeReportPhoto(ctx, input)),
);
