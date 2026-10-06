"use server";

import { revalidatePath } from "next/cache";

import { definePortalAction } from "@/server/portal/action";

import { createPortalRequestSchema } from "./schemas";
import { createPortalRequest } from "./service";

/** A buyer sends a request about one of their sales from the portal. */
export const createPortalRequestAction = definePortalAction(
  createPortalRequestSchema,
  async (input, ctx) => {
    const created = await createPortalRequest(ctx, input);
    revalidatePath(`/[locale]/portal/sales/${input.reservationId}`, "page");
    return created;
  },
);
