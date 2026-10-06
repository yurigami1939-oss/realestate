"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  cancelMovementSchema,
  cashCountSchema,
  closeAccountSchema,
  createAccountSchema,
  recordMovementSchema,
  updateAccountSchema,
} from "./schemas";
import {
  cancelMovement,
  closeAccount,
  createAccount,
  recordCashCount,
  recordMovement,
  updateAccount,
} from "./service";

const refresh = () => revalidatePath("/[locale]/treasury", "layout");

export const createAccountAction = defineAction(
  { input: createAccountSchema, permission: "treasury:update" },
  async (input, ctx) => {
    const created = await createAccount(ctx, input);
    refresh();
    return created;
  },
);

export const updateAccountAction = defineAction(
  { input: updateAccountSchema, permission: "treasury:update" },
  async (input, ctx) => {
    await updateAccount(ctx, input);
    refresh();
  },
);

export const closeAccountAction = defineAction(
  { input: closeAccountSchema, permission: "treasury:update" },
  async (input, ctx) => {
    await closeAccount(ctx, input);
    refresh();
  },
);

export const recordMovementAction = defineAction(
  { input: recordMovementSchema, permission: "treasury:update" },
  async (input, ctx) => {
    const created = await recordMovement(ctx, input);
    refresh();
    return created;
  },
);

export const cancelMovementAction = defineAction(
  { input: cancelMovementSchema, permission: "treasury:update" },
  async (input, ctx) => {
    await cancelMovement(ctx, input);
    refresh();
  },
);

export const recordCashCountAction = defineAction(
  { input: cashCountSchema, permission: "treasury:count" },
  async (input, ctx) => {
    const created = await recordCashCount(ctx, input);
    refresh();
    return created;
  },
);
