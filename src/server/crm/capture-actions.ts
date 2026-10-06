"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { createCaptureKey, revokeCaptureKey } from "./capture";
import { captureKeyIdSchema, createCaptureKeySchema } from "./schemas";

export const createCaptureKeyAction = defineAction(
  { input: createCaptureKeySchema, permission: "lead:assign" },
  async (input, ctx) => {
    const created = await createCaptureKey(ctx, input);
    revalidatePath("/[locale]/settings/lead-capture", "page");
    return created;
  },
);
export const revokeCaptureKeyAction = defineAction(
  { input: captureKeyIdSchema, permission: "lead:assign" },
  async (input, ctx) => {
    await revokeCaptureKey(ctx, input);
    revalidatePath("/[locale]/settings/lead-capture", "page");
  },
);
