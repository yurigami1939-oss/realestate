"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { saveMarketingSpend } from "./marketing";
import { saveMarketingSpendSchema } from "./schemas";

export const saveMarketingSpendAction = defineAction(
  { input: saveMarketingSpendSchema, permission: "target:update" },
  async (input, ctx) => {
    await saveMarketingSpend(ctx, input);
    revalidatePath("/[locale]/reports", "page");
  },
);
