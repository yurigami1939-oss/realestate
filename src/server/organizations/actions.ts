"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { defineAction } from "@/server/action";

import {
  cancelInvitationSchema,
  companySettingsSchema,
  inviteMemberSchema,
  removeMemberSchema,
  updateMemberRolesSchema,
} from "./schemas";
import { cancelInvitation, inviteMember, removeMember, updateMemberRoles } from "./service";
import { removeCompanyLogo, updateCompanySettings } from "./settings";

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
