"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { validateMilestoneSchema } from "./schemas";
import { validateMilestone } from "./service";

export const validateMilestoneAction = defineAction(
  { input: validateMilestoneSchema, permission: "milestone:validate" },
  async (input, ctx) => {
    const result = await validateMilestone(ctx, input);
    revalidatePath("/[locale]/projects", "layout");
    revalidatePath("/[locale]/sales", "layout");
    return result;
  },
);
