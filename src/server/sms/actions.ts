"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  removeSmsOptOutSchema,
  smsOptOutSchema,
  smsSettingsSchema,
  testSmsSchema,
} from "./schemas";
import { addSmsOptOut, removeSmsOptOut, saveSmsSettings, sendTestSms } from "./service";

export const saveSmsSettingsAction = defineAction(
  { input: smsSettingsSchema, permission: "organization:update" },
  async (input, ctx) => {
    await saveSmsSettings(ctx, input);
    revalidatePath("/[locale]/settings/sms", "page");
  },
);

export const sendTestSmsAction = defineAction(
  { input: testSmsSchema, permission: "organization:update" },
  async (input, ctx) => {
    const result = await sendTestSms(ctx, input);
    revalidatePath("/[locale]/sms", "page");
    return result;
  },
);

export const addSmsOptOutAction = defineAction(
  { input: smsOptOutSchema, permission: "notification:update" },
  async (input, ctx) => {
    await addSmsOptOut(ctx, input);
    revalidatePath("/[locale]/sms", "page");
  },
);

export const removeSmsOptOutAction = defineAction(
  { input: removeSmsOptOutSchema, permission: "notification:update" },
  async (input, ctx) => {
    await removeSmsOptOut(ctx, input);
    revalidatePath("/[locale]/sms", "page");
  },
);
