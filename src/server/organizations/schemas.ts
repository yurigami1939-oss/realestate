/** Isomorphic: shared by the members page forms and the organization actions. */
import { z } from "zod";

import { invitableRoles } from "@/lib/permissions";
import { intText, optionalText, requiredText } from "@/lib/zod";

const invitableRole = z.enum(invitableRoles);

export const memberRolesSchema = z.array(invitableRole).min(1, "validation.rolesRequired");

export const inviteMemberSchema = z.object({
  email: z.email("validation.email").trim().toLowerCase(),
  roles: memberRolesSchema,
});

export const cancelInvitationSchema = z.object({ invitationId: z.uuid() });

export const updateMemberRolesSchema = z.object({ memberId: z.uuid(), roles: memberRolesSchema });

export const removeMemberSchema = z.object({ memberId: z.uuid() });

/** Company settings page: legal identity (printed on documents) and sales settings. */
export const companySettingsSchema = z.object({
  name: requiredText(120),
  legalName: optionalText(200),
  address: optionalText(300),
  wilaya: optionalText(80),
  phone: optionalText(40),
  rcNumber: optionalText(40),
  nif: optionalText(40),
  nis: optionalText(40),
  aiNumber: optionalText(40),
  quotationValidityDays: intText(1, 365),
});
