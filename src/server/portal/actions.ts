"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { inviteToPortal, revokePortalLink } from "./invitations";
import { inviteBuyerSchema, inviteResidentSchema, portalLinkIdSchema } from "./schemas";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/buyers", "layout");
    revalidatePath("/[locale]/residences", "layout");
    return result;
  });
}

export const inviteBuyerToPortalAction = defineAction(
  { input: inviteBuyerSchema, permission: "portal:invite" },
  (input, ctx) => mutation(() => inviteToPortal(ctx, { kind: "buyer", id: input.buyerId })),
);
export const inviteResidentToPortalAction = defineAction(
  { input: inviteResidentSchema, permission: "portal:invite" },
  (input, ctx) => mutation(() => inviteToPortal(ctx, { kind: "resident", id: input.residentId })),
);
export const revokePortalLinkAction = defineAction(
  { input: portalLinkIdSchema, permission: "portal:invite" },
  (input, ctx) => mutation(() => revokePortalLink(ctx, input.linkId)),
);
