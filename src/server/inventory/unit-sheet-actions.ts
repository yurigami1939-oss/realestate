"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { defineAction } from "@/server/action";

import { issueUnitSheet } from "./unit-sheets";

/** A fiche du lot for a prospect (reused the same day while nothing changed). */
export const issueUnitSheetAction = defineAction(
  { input: z.object({ unitId: z.uuid() }), permission: "inventory:read" },
  async (input, ctx) => {
    const issued = await issueUnitSheet(ctx, input);
    revalidatePath("/[locale]/projects", "layout");
    return issued;
  },
);
