"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { setModuleSchema } from "./schemas";
import { setModuleEnabled } from "./switches";

export const setModuleEnabledAction = defineAction(
  { input: setModuleSchema, permission: "organization:update" },
  async (input, ctx) => {
    await setModuleEnabled(ctx, input);
    // The sidebar, the dashboard and every page follow the modules.
    revalidatePath("/[locale]", "layout");
  },
);
