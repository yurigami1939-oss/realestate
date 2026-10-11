/** Isomorphic: shared by the members page forms and the organization actions. */
import { z } from "zod";

import { type DocumentTextKind, documentTextKinds, MAX_DOCUMENT_TEXT } from "@/lib/document-texts";
import { grantablePermissions, isGrantablePermission, staffRoles } from "@/lib/permissions";
import {
  intText,
  optionalMoneyText,
  optionalPercentText,
  optionalText,
  percentText,
  requiredText,
} from "@/lib/zod";

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
  /** Indemnity for late delivery owed to buyers (shown, never booked); 0 = off. */
  deliveryPenaltyMonthlyRate: percentText(0, 10),
  deliveryPenaltyCap: percentText(0, 100),
  /** Termination for non-payment: a notice's delay, notices first, retention proposed. */
  formalNoticeDays: intText(1, 90),
  formalNoticesRequired: intText(1, 5),
  terminationRetention: percentText(0, 100),
  fgcmpiNumber: optionalText(40),
  /** Receipts and calls e-mailed to the clients who gave an address. */
  emailDocuments: z.boolean().default(false),
  /** Cumulative VSP limits per stage (CLAUDE.md §12); empty = no check. */
  vspLimitSigning: optionalPercentText(0, 100),
  vspLimitFoundations: optionalPercentText(0, 100),
  vspLimitStructure: optionalPercentText(0, 100),
  vspLimitCompletion: optionalPercentText(0, 100),
});

/** A custom role (CLAUDE.md §5 Auth & roles): its name, base staff role and permissions. */
export const customRoleSchema = z.object({
  name: requiredText(60),
  baseRole: staffRole,
  permissions: z
    .array(z.string().refine(isGrantablePermission, "validation.permission"))
    .min(1, "customRoles.errors.noPermission")
    .max(grantablePermissions.length),
});
export const updateCustomRoleSchema = customRoleSchema.extend({ customRoleId: z.uuid() });
export const archiveCustomRoleSchema = z.object({ customRoleId: z.uuid() });

/** A member's custom role, or none (`""`). */
export const assignCustomRoleSchema = z.object({
  memberId: z.uuid(),
  customRoleId: z
    .uuid()
    .or(z.literal(""))
    .transform((v) => v || null),
});

/** The organization's wording per kind of document, French and Arabic (blank = none). */
const documentText = z.object({
  fr: z.string().trim().max(MAX_DOCUMENT_TEXT, "validation.tooLong").default(""),
  ar: z.string().trim().max(MAX_DOCUMENT_TEXT, "validation.tooLong").default(""),
});
/**
 * The figures a buyer's acquisition costs are estimated with (quotations): the notary's scale by
 * tranches (a blank ceiling = the rest of the price, last), VAT on the fees, duties, fixed costs.
 */
export const acquisitionCostsSchema = z
  .object({
    tranches: z.array(z.object({ upTo: optionalMoneyText(), rate: percentText(0, 20) })).max(10),
    notaryVat: optionalPercentText(0, 100),
    registration: optionalPercentText(0, 100),
    publication: optionalPercentText(0, 100),
    fixedFees: optionalMoneyText(),
  })
  .superRefine((v, ctx) => {
    const ceilings = v.tranches.map((t) => t.upTo);
    const ordered = ceilings.every((upTo, i) => {
      const previous = i === 0 ? 0n : ceilings[i - 1];
      if (upTo === null) return i === ceilings.length - 1;
      return previous !== null && previous !== undefined && upTo > previous;
    });
    if (!ordered) {
      ctx.addIssue({
        code: "custom",
        path: ["tranches"],
        message: "acquisitionCosts.errors.tranches",
      });
    }
  });

export const documentTextsSchema = z.object({
  texts: z.object(
    Object.fromEntries(documentTextKinds.map((kind) => [kind, documentText.optional()])) as Record<
      DocumentTextKind,
      z.ZodOptional<typeof documentText>
    >,
  ),
});
