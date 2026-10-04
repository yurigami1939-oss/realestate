"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  assignTicketSchema,
  changeTicketStatusSchema,
  commentTicketSchema,
  createTicketSchema,
} from "./schemas";
import { assignTicket, changeTicketStatus, commentTicket, createTicket } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/tickets", "layout");
    return result;
  });
}

export const createTicketAction = defineAction(
  { input: createTicketSchema, permission: "ticket:create" },
  (input, ctx) => mutation(() => createTicket(ctx, input)),
);
export const changeTicketStatusAction = defineAction(
  { input: changeTicketStatusSchema, permission: "ticket:update" },
  (input, ctx) => mutation(() => changeTicketStatus(ctx, input)),
);
export const assignTicketAction = defineAction(
  { input: assignTicketSchema, permission: "ticket:update" },
  (input, ctx) => mutation(() => assignTicket(ctx, input)),
);
export const commentTicketAction = defineAction(
  { input: commentTicketSchema, permission: "ticket:update" },
  (input, ctx) => mutation(() => commentTicket(ctx, input)),
);
