import "server-only";

import { APIError } from "better-auth/api";
import type { z } from "zod";

import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { auth } from "@/server/auth/auth";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { getMember } from "./queries";
import type {
  cancelInvitationSchema,
  inviteMemberSchema,
  removeMemberSchema,
  updateMemberRolesSchema,
} from "./schemas";

/**
 * Member management. Better Auth performs the change (and re-checks permissions);
 * we check first, protect the owner and write the audit entry with the acting user.
 * Better Auth writes outside our transaction, so the audit entry follows a successful change.
 */

async function callAuth<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof APIError)) throw error;
    const code = (error.body as { code?: string } | undefined)?.code ?? null;
    if (error.status === "FORBIDDEN" || error.status === "UNAUTHORIZED")
      throw new AppError("FORBIDDEN");
    if (code === "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION") {
      throw new AppError("CONFLICT", "members.alreadyMember");
    }
    if (code?.endsWith("NOT_FOUND")) throw new AppError("NOT_FOUND");
    throw new AppError("VALIDATION", "errors.VALIDATION", { details: { code } });
  }
}

async function assertNotOwner(ctx: TenantCtx, memberId: string) {
  const target = await getMember(ctx.orgId, memberId);
  if (!target) throw new AppError("NOT_FOUND");
  if (target.roles.includes("owner")) throw new AppError("FORBIDDEN", "members.ownerLocked");
  return target;
}

export async function inviteMember(
  ctx: TenantCtx,
  headers: Headers,
  input: z.output<typeof inviteMemberSchema>,
) {
  assertCan(ctx, "invitation:create");
  const invitation = await callAuth(() =>
    auth.api.createInvitation({
      headers,
      body: { email: input.email, role: input.roles, organizationId: ctx.orgId },
    }),
  );
  await withTenant(ctx, (tx) =>
    recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "invitation.create",
      entityType: "invitation",
      entityId: invitation.id,
      after: { email: input.email, roles: input.roles },
    }),
  );
  return { id: invitation.id };
}

export async function cancelInvitation(
  ctx: TenantCtx,
  headers: Headers,
  input: z.output<typeof cancelInvitationSchema>,
) {
  assertCan(ctx, "invitation:cancel");
  await callAuth(() =>
    auth.api.cancelInvitation({ headers, body: { invitationId: input.invitationId } }),
  );
  await withTenant(ctx, (tx) =>
    recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "invitation.cancel",
      entityType: "invitation",
      entityId: input.invitationId,
    }),
  );
}

export async function updateMemberRoles(
  ctx: TenantCtx,
  headers: Headers,
  input: z.output<typeof updateMemberRolesSchema>,
) {
  assertCan(ctx, "member:update");
  const target = await assertNotOwner(ctx, input.memberId);
  await callAuth(() =>
    auth.api.updateMemberRole({
      headers,
      body: { memberId: input.memberId, role: input.roles, organizationId: ctx.orgId },
    }),
  );
  await withTenant(ctx, (tx) =>
    recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "member.update_roles",
      entityType: "member",
      entityId: input.memberId,
      before: { roles: target.roles },
      after: { roles: input.roles },
    }),
  );
}

export async function removeMember(
  ctx: TenantCtx,
  headers: Headers,
  input: z.output<typeof removeMemberSchema>,
) {
  assertCan(ctx, "member:delete");
  const target = await assertNotOwner(ctx, input.memberId);
  await callAuth(() =>
    auth.api.removeMember({
      headers,
      body: { memberIdOrEmail: input.memberId, organizationId: ctx.orgId },
    }),
  );
  await withTenant(ctx, (tx) =>
    recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "member.remove",
      entityType: "member",
      entityId: input.memberId,
      before: { email: target.email, roles: target.roles },
    }),
  );
}
