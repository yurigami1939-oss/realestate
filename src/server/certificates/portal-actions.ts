"use server";

import { revalidatePath } from "next/cache";

import { definePortalAction } from "@/server/portal/action";

import { portalStatementSchema } from "./schemas";
import { issuePortalStatement } from "./service";

/** The buyer draws its statement of account from the portal (reused the same day). */
export const issuePortalStatementAction = definePortalAction(
  portalStatementSchema,
  async (input, ctx) => {
    const issued = await issuePortalStatement(ctx, input);
    revalidatePath(`/[locale]/portal/sales/${input.reservationId}`, "page");
    return issued;
  },
);
