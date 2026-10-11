"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { defineAction } from "@/server/action";

import {
  acquisitionCostsSchema,
  archiveCustomRoleSchema,
  assignCustomRoleSchema,
  cancelInvitationSchema,
  companySettingsSchema,
  customRoleSchema,
  documentTextsSchema,
  inviteMemberSchema,
  removeMemberSchema,
  updateCustomRoleSchema,
  updateMemberRolesSchema,
} from "./schemas";
import { listCommunes } from "./communes";
import {
  archiveCustomRole,
  assignCustomRole,
  createCustomRole,
  updateCustomRole,
} from "./custom-roles";
import { cancelInvitation, inviteMember, removeMember, updateMemberRoles } from "./service";
import {
  removeCompanyLogo,
  saveAcquisitionCosts,
  saveDocumentTexts,
  updateCompanySettings,
} from "./settings";

const MEMBERS_PAGE = "/[locale]/settings/members";

export const inviteMemberAction = defineAction(
  { input: inviteMemberSchema, permission: "invitation:create" },
  async (input, ctx) => {
    const result = await inviteMember(ctx, await headers(), input);
    revalidatePath(MEMBERS_PAGE, "page");
    return result;
  },
);

export const cancelInvitationAction = defineAction(
  { input: cancelInvitationSchema, permission: "invitation:cancel" },
  async (input, ctx) => {
    await cancelInvitation(ctx, await headers(), input);
    revalidatePath(MEMBERS_PAGE, "page");
  },
);

export const updateMemberRolesAction = defineAction(
  { input: updateMemberRolesSchema, permission: "member:update" },
  async (input, ctx) => {
    await updateMemberRoles(ctx, await headers(), input);
    revalidatePath(MEMBERS_PAGE, "page");
  },
);

export const removeMemberAction = defineAction(
  { input: removeMemberSchema, permission: "member:delete" },
  async (input, ctx) => {
    await removeMember(ctx, await headers(), input);
    revalidatePath(MEMBERS_PAGE, "page");
  },
);

export const removeCompanyLogoAction = defineAction(
  { input: z.object({}), permission: "organization:update" },
  async (_input, ctx) => {
    await removeCompanyLogo(ctx);
    revalidatePath("/[locale]/settings/company", "page");
  },
);

export const updateCompanySettingsAction = defineAction(
  { input: companySettingsSchema, permission: "organization:update" },
  async (input, ctx) => {
    await updateCompanySettings(ctx, input);
    // The name shows in the shell (org switcher, header) on every page.
    revalidatePath("/[locale]", "layout");
  },
);

/** The communes already named in the organization's records (address fields' suggestions). */
export const listCommunesAction = defineAction({ input: z.object({}) }, (_input, ctx) =>
  listCommunes(ctx),
);

const ROLES_PAGE = "/[locale]/settings/roles";

export const createCustomRoleAction = defineAction(
  { input: customRoleSchema, permission: "member:update" },
  async (input, ctx) => {
    const result = await createCustomRole(ctx, input);
    revalidatePath(ROLES_PAGE, "page");
    return result;
  },
);

export const updateCustomRoleAction = defineAction(
  { input: updateCustomRoleSchema, permission: "member:update" },
  async (input, ctx) => {
    await updateCustomRole(ctx, await headers(), input);
    revalidatePath(ROLES_PAGE, "page");
    revalidatePath(MEMBERS_PAGE, "page");
  },
);

export const archiveCustomRoleAction = defineAction(
  { input: archiveCustomRoleSchema, permission: "member:update" },
  async (input, ctx) => {
    await archiveCustomRole(ctx, input);
    revalidatePath(ROLES_PAGE, "page");
  },
);

export const assignCustomRoleAction = defineAction(
  { input: assignCustomRoleSchema, permission: "member:update" },
  async (input, ctx) => {
    await assignCustomRole(ctx, await headers(), input);
    revalidatePath(MEMBERS_PAGE, "page");
    revalidatePath(ROLES_PAGE, "page");
  },
);

export const saveAcquisitionCostsAction = defineAction(
  { input: acquisitionCostsSchema, permission: "organization:update" },
  async (input, ctx) => {
    await saveAcquisitionCosts(ctx, input);
    revalidatePath("/[locale]/settings/company", "page");
  },
);

export const saveDocumentTextsAction = defineAction(
  { input: documentTextsSchema, permission: "organization:update" },
  async (input, ctx) => {
    await saveDocumentTexts(ctx, input);
    revalidatePath("/[locale]/settings/documents", "page");
  },
);
