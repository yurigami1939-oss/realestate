"use server";

import { revalidatePath } from "next/cache";

import { definePortalAction } from "./action";
import { createPortalTicket } from "./residences";
import { portalTicketSchema } from "./schemas";

/** Portal: a resident opens a ticket on its unit or the common areas. */
export const createPortalTicketAction = definePortalAction(
  portalTicketSchema,
  async (input, ctx) => {
    const created = await createPortalTicket(ctx, input);
    revalidatePath("/[locale]/portal", "layout");
    return created;
  },
);
