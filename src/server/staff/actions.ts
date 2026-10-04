"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { saveAttendance } from "./attendance";
import {
  advanceIdSchema,
  createStaffSchema,
  endStaffSchema,
  recordAdvanceSchema,
  saveAttendanceSchema,
  updateStaffSchema,
} from "./schemas";
import { createStaff, deleteAdvance, endStaff, recordAdvance, updateStaff } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/residences", "layout");
    return result;
  });
}

export const createStaffAction = defineAction(
  { input: createStaffSchema, permission: "staff:update" },
  (input, ctx) => mutation(() => createStaff(ctx, input)),
);
export const updateStaffAction = defineAction(
  { input: updateStaffSchema, permission: "staff:update" },
  (input, ctx) => mutation(() => updateStaff(ctx, input)),
);
export const endStaffAction = defineAction(
  { input: endStaffSchema, permission: "staff:update" },
  (input, ctx) => mutation(() => endStaff(ctx, input)),
);
export const recordAdvanceAction = defineAction(
  { input: recordAdvanceSchema, permission: "staff:update" },
  (input, ctx) => mutation(() => recordAdvance(ctx, input)),
);
export const deleteAdvanceAction = defineAction(
  { input: advanceIdSchema, permission: "staff:update" },
  (input, ctx) => mutation(() => deleteAdvance(ctx, input.advanceId)),
);
export const saveAttendanceAction = defineAction(
  { input: saveAttendanceSchema, permission: "staff:update" },
  (input, ctx) => mutation(() => saveAttendance(ctx, input)),
);
