/** Isomorphic: shared by the portal access controls and their actions. */
import { z } from "zod";

import { ticketCategories, ticketPriorities } from "@/lib/tickets";
import { optionalText, requiredText } from "@/lib/zod";

export const inviteBuyerSchema = z.object({ buyerId: z.uuid() });
export const inviteResidentSchema = z.object({ residentId: z.uuid() });
export const portalLinkIdSchema = z.object({ linkId: z.uuid() });

/** A ticket opened from the portal: on one of the account's units or the common areas. */
export const portalTicketSchema = z.object({
  residenceId: z.uuid(),
  /** Empty: common areas. */
  unitId: z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
  title: requiredText(160),
  description: optionalText(4000),
  category: z.enum(ticketCategories),
  priority: z.enum(ticketPriorities),
});
