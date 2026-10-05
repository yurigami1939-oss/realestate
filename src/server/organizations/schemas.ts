/** Isomorphic: shared by the members page forms and the organization actions. */
import { z } from "zod";

import { staffRoles } from "@/lib/permissions";
import { intText, optionalPercentText, optionalText, percentText, requiredText } from "@/lib/zod";

/** Staff roles only: the portal role is given by a portal invitation from a record. */
const staffRole = z.enum(staffRoles, { error: "validation.staffRole" });

export const memberRolesSchema = z.array(staffRole).min(1, "validation.rolesRequired");

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
  optionHours: intText(1, 720),
  paymentCallDelayDays: intText(0, 180),
  withdrawalRetention: percentText(0, 100),
  penaltyMonthlyRate: percentText(0, 10),
  penaltyGraceDays: intText(0, 365),
  penaltyCap: percentText(0, 100),
  defaultCommissionRate: percentText(0, 20),
  /** Cumulative VSP limits per stage (CLAUDE.md §12); empty = no check. */
  vspLimitSigning: optionalPercentText(0, 100),
  vspLimitFoundations: optionalPercentText(0, 100),
  vspLimitStructure: optionalPercentText(0, 100),
  vspLimitCompletion: optionalPercentText(0, 100),
});
