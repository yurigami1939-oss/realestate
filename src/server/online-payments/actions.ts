"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { gatewaySettingsSchema, onlinePaymentIdSchema, refundOnlinePaymentSchema } from "./schemas";
import { recheckOnlinePayment, refundOnlinePayment, saveGatewaySettings } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/online-payments", "layout");
    revalidatePath("/[locale]/sales", "layout");
    revalidatePath("/[locale]/residences", "layout");
    revalidatePath("/[locale]/dashboard", "page");
    return result;
  });
}

export const saveGatewaySettingsAction = defineAction(
  { input: gatewaySettingsSchema, permission: "organization:update" },
  async (input, ctx) => {
    await saveGatewaySettings(ctx, input);
    revalidatePath("/[locale]/settings/online-payment", "page");
  },
);
export const recheckOnlinePaymentAction = defineAction(
  { input: onlinePaymentIdSchema, permission: "payment:create" },
  (input, ctx) =>
    mutation(async () => {
      const row = await recheckOnlinePayment(ctx, input.onlinePaymentId);
      return { status: row?.status ?? null };
    }),
);
export const refundOnlinePaymentAction = defineAction(
  { input: refundOnlinePaymentSchema, permission: "payment:cancel" },
  (input, ctx) => mutation(() => refundOnlinePayment(ctx, input)),
);
