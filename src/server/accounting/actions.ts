"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { accountingCodesSchema } from "./schemas";
import { saveAccountingCodes } from "./service";

export const saveAccountingCodesAction = defineAction(
  { input: accountingCodesSchema, permission: "treasury:update" },
  async (input, ctx) => {
    await saveAccountingCodes(ctx, input);
    revalidatePath("/[locale]/treasury", "layout");
  },
);
