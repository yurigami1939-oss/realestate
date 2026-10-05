/** Isomorphic: shared by the portal access controls and their actions. */
import { z } from "zod";

export const inviteBuyerSchema = z.object({ buyerId: z.uuid() });
export const inviteResidentSchema = z.object({ residentId: z.uuid() });
export const portalLinkIdSchema = z.object({ linkId: z.uuid() });
