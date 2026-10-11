"use server";

import { defineAction } from "@/server/action";
import { definePortalAction } from "@/server/portal/action";

import { pushDeviceSchema, pushEndpointSchema, pushSubscriptionSchema } from "./schemas";
import { removePushDevice, sendTestPush, subscribePush, unsubscribePush } from "./service";

// Each member turns notifications on for their own devices: no permission beyond being one.
export const subscribePushAction = defineAction(
  { input: pushSubscriptionSchema },
  async (input, ctx) => subscribePush(ctx, input),
);
export const unsubscribePushAction = defineAction(
  { input: pushEndpointSchema },
  async (input, ctx) => unsubscribePush(ctx, input),
);
export const testPushAction = defineAction({ input: pushEndpointSchema }, async (input, ctx) =>
  sendTestPush(ctx, input),
);
export const removePushDeviceAction = defineAction(
  { input: pushDeviceSchema },
  async (input, ctx) => removePushDevice(ctx, input),
);

// The same for portal accounts (buyers, co-owners, tenants).
export const subscribePortalPushAction = definePortalAction(pushSubscriptionSchema, (input, ctx) =>
  subscribePush(ctx, input),
);
export const unsubscribePortalPushAction = definePortalAction(pushEndpointSchema, (input, ctx) =>
  unsubscribePush(ctx, input),
);
export const testPortalPushAction = definePortalAction(pushEndpointSchema, (input, ctx) =>
  sendTestPush(ctx, input),
);
export const removePortalPushDeviceAction = definePortalAction(pushDeviceSchema, (input, ctx) =>
  removePushDevice(ctx, input),
);
