"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { residentWhatsappSchema, whatsappSettingsSchema } from "./schemas";
import { saveWhatsappSettings, setResidentWhatsapp } from "./service";

export const saveWhatsappSettingsAction = defineAction(
  { input: whatsappSettingsSchema, permission: "organization:update" },
  async (input, ctx) => {
    await saveWhatsappSettings(ctx, input);
    revalidatePath("/[locale]/settings/whatsapp", "page");
  },
);

export const setResidentWhatsappAction = defineAction(
  { input: residentWhatsappSchema, permission: "residence:update" },
  async (input, ctx) => {
    await setResidentWhatsapp(ctx, input);
    revalidatePath("/[locale]/residences", "layout");
  },
);
