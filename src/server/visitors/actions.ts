"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";
import { definePortalAction } from "@/server/portal/action";

import { announceVisitorSchema, logVisitorSchema, visitorPassIdSchema } from "./schemas";
import { announceVisitor, cancelVisitor, logVisitor, recordArrival } from "./service";

const REGISTER_PAGE = "/[locale]/residences/[residenceId]/visitors";
const PORTAL_PAGE = "/[locale]/portal/visitors";

export const recordArrivalAction = defineAction(
  { input: visitorPassIdSchema, permission: "visitor:update" },
  async (input, ctx) => {
    await recordArrival(ctx, input);
    revalidatePath(REGISTER_PAGE, "page");
  },
);

export const logVisitorAction = defineAction(
  { input: logVisitorSchema, permission: "visitor:update" },
  async (input, ctx) => {
    const logged = await logVisitor(ctx, input);
    revalidatePath(REGISTER_PAGE, "page");
    return logged;
  },
);

export const announceVisitorAction = definePortalAction(
  announceVisitorSchema,
  async (input, ctx) => {
    const announced = await announceVisitor(ctx, input);
    revalidatePath(PORTAL_PAGE, "page");
    return announced;
  },
);

export const cancelVisitorAction = definePortalAction(visitorPassIdSchema, async (input, ctx) => {
  await cancelVisitor(ctx, input);
  revalidatePath(PORTAL_PAGE, "page");
});
