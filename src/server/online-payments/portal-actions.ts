"use server";

import { revalidatePath } from "next/cache";

import { definePortalAction } from "@/server/portal/action";

import { onlinePaymentIdSchema, startOnlinePaymentSchema } from "./schemas";
import { refreshPortalOnlinePayment, startOnlinePayment } from "./service";

/** Portal: registers the payment with the gateway; the browser then goes to its page. */
export const startOnlinePaymentAction = definePortalAction(startOnlinePaymentSchema, (input, ctx) =>
  startOnlinePayment(ctx, input),
);

/** Portal: asks the gateway again where the payer's payment stands. */
export const refreshOnlinePaymentAction = definePortalAction(
  onlinePaymentIdSchema,
  async (input, ctx) => {
    const result = await refreshPortalOnlinePayment(ctx, input.onlinePaymentId);
    revalidatePath("/[locale]/portal", "layout");
    return result;
  },
);
