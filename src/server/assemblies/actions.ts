"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  addResolutionSchema,
  assemblyIdSchema,
  closeAssemblySchema,
  createAssemblySchema,
  resolutionIdSchema,
  saveAttendanceSchema,
  saveVotesSchema,
  updateAssemblySchema,
  updateResolutionSchema,
} from "./schemas";
import {
  addResolution,
  closeAssembly,
  conveneAssembly,
  createAssembly,
  deleteAssembly,
  deleteResolution,
  saveAttendance,
  saveVotes,
  updateAssembly,
  updateResolution,
} from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/residences", "layout");
    return result;
  });
}

export const createAssemblyAction = defineAction(
  { input: createAssemblySchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => createAssembly(ctx, input)),
);
export const updateAssemblyAction = defineAction(
  { input: updateAssemblySchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => updateAssembly(ctx, input)),
);
export const deleteAssemblyAction = defineAction(
  { input: assemblyIdSchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => deleteAssembly(ctx, input.assemblyId)),
);
export const addResolutionAction = defineAction(
  { input: addResolutionSchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => addResolution(ctx, input)),
);
export const updateResolutionAction = defineAction(
  { input: updateResolutionSchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => updateResolution(ctx, input)),
);
export const deleteResolutionAction = defineAction(
  { input: resolutionIdSchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => deleteResolution(ctx, input.resolutionId)),
);
export const conveneAssemblyAction = defineAction(
  { input: assemblyIdSchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => conveneAssembly(ctx, input.assemblyId)),
);
export const saveAttendanceAction = defineAction(
  { input: saveAttendanceSchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => saveAttendance(ctx, input)),
);
export const saveVotesAction = defineAction(
  { input: saveVotesSchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => saveVotes(ctx, input)),
);
export const closeAssemblyAction = defineAction(
  { input: closeAssemblySchema, permission: "assembly:update" },
  (input, ctx) => mutation(() => closeAssembly(ctx, input)),
);
