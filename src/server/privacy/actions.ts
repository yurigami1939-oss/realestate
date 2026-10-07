"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { anonymizeLeadSchema } from "./schemas";
import { anonymizeLead } from "./service";

export const anonymizeLeadAction = defineAction(
  { input: anonymizeLeadSchema, permission: "personal_data:erase" },
  async (input, ctx) => {
    await anonymizeLead(ctx, input);
    revalidatePath("/[locale]/leads", "layout");
  },
);
