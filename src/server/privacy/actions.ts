"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { savePrivacySettings } from "./retention";
import { anonymizeLeadSchema, privacySettingsSchema } from "./schemas";
import { anonymizeLead } from "./service";

export const anonymizeLeadAction = defineAction(
  { input: anonymizeLeadSchema, permission: "personal_data:erase" },
  async (input, ctx) => {
    await anonymizeLead(ctx, input);
    revalidatePath("/[locale]/leads", "layout");
  },
);

export const savePrivacySettingsAction = defineAction(
  { input: privacySettingsSchema, permission: "organization:update" },
  async (input, ctx) => {
    await savePrivacySettings(ctx, input);
    revalidatePath("/[locale]/settings/privacy", "page");
  },
);
