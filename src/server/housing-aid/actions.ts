"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { housingAidSchema } from "./schemas";
import { saveHousingAid } from "./service";

export const saveHousingAidAction = defineAction(
  { input: housingAidSchema, permission: "organization:update" },
  async (input, ctx) => {
    await saveHousingAid(ctx, input);
    revalidatePath("/[locale]/settings/company", "page");
    revalidatePath("/[locale]/sales", "layout");
  },
);
