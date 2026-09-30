/** Isomorphic: shared by the members page forms and the organization actions. */
import { z } from "zod";

import { invitableRoles } from "@/lib/permissions";

const invitableRole = z.enum(invitableRoles);

export const memberRolesSchema = z.array(invitableRole).min(1, "validation.rolesRequired");

export const inviteMemberSchema = z.object({
  email: z.email("validation.email").trim().toLowerCase(),
  roles: memberRolesSchema,
});

export const cancelInvitationSchema = z.object({ invitationId: z.uuid() });

export const updateMemberRolesSchema = z.object({ memberId: z.uuid(), roles: memberRolesSchema });

export const removeMemberSchema = z.object({ memberId: z.uuid() });
