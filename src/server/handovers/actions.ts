"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  addPunchItemSchema,
  cancelPunchItemSchema,
  closeReservesSchema,
  liftPunchItemSchema,
  pastDeliveriesSchema,
  punchItemIdSchema,
  requestHandoverDocumentSchema,
  scheduleHandoverSchema,
  signHandoverSchema,
  updatePunchItemSchema,
} from "./schemas";
import {
  addPunchItem,
  cancelPunchItem,
  closeReserves,
  deletePunchItem,
  liftPunchItem,
  recordPastDeliveries,
  requestHandoverDocument,
  scheduleHandover,
  signHandover,
  updatePunchItem,
} from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/deliveries", "layout");
    revalidatePath("/[locale]/sales", "layout");
    return result;
  });
}

export const scheduleHandoverAction = defineAction(
  { input: scheduleHandoverSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => scheduleHandover(ctx, input)),
);
export const addPunchItemAction = defineAction(
  { input: addPunchItemSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => addPunchItem(ctx, input)),
);
export const updatePunchItemAction = defineAction(
  { input: updatePunchItemSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => updatePunchItem(ctx, input)),
);
export const deletePunchItemAction = defineAction(
  { input: punchItemIdSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => deletePunchItem(ctx, input.punchItemId)),
);
export const liftPunchItemAction = defineAction(
  { input: liftPunchItemSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => liftPunchItem(ctx, input)),
);
export const cancelPunchItemAction = defineAction(
  { input: cancelPunchItemSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => cancelPunchItem(ctx, input)),
);
export const signHandoverAction = defineAction(
  { input: signHandoverSchema, permission: "handover:update" },
  async (input, ctx) => {
    const result = await mutation(() => signHandover(ctx, input));
    // The unit is delivered; its residence may have new co-owners.
    revalidatePath("/[locale]/projects", "layout");
    revalidatePath("/[locale]/residences", "layout");
    return result;
  },
);
export const closeReservesAction = defineAction(
  { input: closeReservesSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => closeReserves(ctx, input)),
);
export const recordPastDeliveriesAction = defineAction(
  { input: pastDeliveriesSchema, permission: "handover:update" },
  async (input, ctx) => {
    const result = await recordPastDeliveries(ctx, input);
    revalidatePath("/[locale]/construction", "layout");
    revalidatePath("/[locale]/projects", "layout");
    return result;
  },
);
export const requestHandoverDocumentAction = defineAction(
  { input: requestHandoverDocumentSchema, permission: "handover:read" },
  (input, ctx) => requestHandoverDocument(ctx, input),
);
