"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { issueReminderSchema } from "./schemas";
import { issueReminderLetter } from "./service";

export const issueReminderAction = defineAction(
  { input: issueReminderSchema, permission: "sale:remind" },
  async (input, ctx) => {
    const result = await issueReminderLetter(ctx, input);
    revalidatePath("/[locale]/sales", "layout");
    return result;
  },
);
