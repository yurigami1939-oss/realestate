import "server-only";

import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import { customRole, memberCustomRole } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  isGrantablePermission,
  isStaffRole,
  type Permission,
  type StaffRole,
} from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { getMember, listMembers } from "./queries";
import type {
  archiveCustomRoleSchema,
  assignCustomRoleSchema,
  customRoleSchema,
  updateCustomRoleSchema,
} from "./schemas";
import { updateMemberRoles } from "./service";

type In<S extends z.ZodType> = z.output<S>;

const nameTaken = () =>
  new AppError("VALIDATION", "customRoles.errors.nameTaken", {
    fieldErrors: { name: ["customRoles.errors.nameTaken"] },
  });

/** A stored base role, checked again (a staff role, never the gérant's nor the portal's). */
function baseRole(value: string): StaffRole {
  if (!isStaffRole(value)) throw new AppError("UNEXPECTED");
  return value;
}

/** The permissions kept: the catalog's, in its order, each once. */
const clean = (permissions: readonly string[]): Permission[] => [
  ...new Set(permissions.filter(isGrantablePermission)),
];

/**
 * The exact permissions of a member's custom role (CLAUDE.md §5 Auth & roles), or null when
 * they hold none — their roles then decide. Read for every request's tenant context.
 */
export async function loadCustomPermissions(
  orgId: string,
  userId: string,
): Promise<Permission[] | null> {
  const [row] = await withTenant({ orgId }, (tx) =>
    tx
      .select({ permissions: customRole.permissions })
      .from(memberCustomRole)
      .innerJoin(customRole, eq(customRole.id, memberCustomRole.customRoleId))
      .where(and(eq(memberCustomRole.userId, userId), isNull(customRole.archivedAt))),
  );
  return row ? clean(row.permissions) : null;
}

/** The organization's custom roles with how many members hold each (`member:update`). */
export async function listCustomRoles(ctx: TenantCtx) {
  assertCan(ctx, "member:update");
  return withTenant(ctx, async (tx) => {
    const roles = await tx
      .select()
      .from(customRole)
      .where(isNull(customRole.archivedAt))
      .orderBy(asc(customRole.name));
    const holders = await tx
      .select({ id: memberCustomRole.customRoleId, n: count() })
      .from(memberCustomRole)
      .groupBy(memberCustomRole.customRoleId);
    const held = new Map(holders.map((h) => [h.id, h.n]));
    return roles.map((r) => ({ ...r, members: held.get(r.id) ?? 0 }));
  });
}

/** The custom role each member holds, by user (members page). */
export async function listMemberCustomRoles(ctx: TenantCtx) {
  assertCan(ctx, "member:update");
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({ userId: memberCustomRole.userId, id: customRole.id, name: customRole.name })
      .from(memberCustomRole)
      .innerJoin(customRole, eq(customRole.id, memberCustomRole.customRoleId)),
  );
  return new Map(rows.map((r) => [r.userId, { id: r.id, name: r.name }]));
}

/** A new custom role (gérant): a name, the staff role it starts from, its permissions. */
export async function createCustomRole(ctx: TenantCtx, input: In<typeof customRoleSchema>) {
  assertCan(ctx, "member:update");
  return withTenant(ctx, async (tx) => {
    const [taken] = await tx
      .select({ id: customRole.id })
      .from(customRole)
      .where(and(eq(customRole.name, input.name), isNull(customRole.archivedAt)));
    if (taken) throw nameTaken();
    const permissions = clean(input.permissions);
    const [row] = await tx
      .insert(customRole)
      .values({
        organizationId: ctx.orgId,
        name: input.name,
        baseRole: input.baseRole,
        permissions,
        createdBy: ctx.userId,
      })
      .returning({ id: customRole.id });
    if (!row) throw new Error("createCustomRole: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.custom_role",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { id: row.id, name: input.name, baseRole: input.baseRole, permissions },
    });
    return row;
  });
}

/**
 * Changes a custom role; its members hold the new permissions at their next request, and take
 * the new base role when it changed.
 */
export async function updateCustomRole(
  ctx: TenantCtx,
  headers: Headers,
  input: In<typeof updateCustomRoleSchema>,
) {
  assertCan(ctx, "member:update");
  const { holders, before } = await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(customRole)
      .where(and(eq(customRole.id, input.customRoleId), isNull(customRole.archivedAt)))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    const [taken] = await tx
      .select({ id: customRole.id })
      .from(customRole)
      .where(and(eq(customRole.name, input.name), isNull(customRole.archivedAt)));
    if (taken && taken.id !== current.id) throw nameTaken();
    const permissions = clean(input.permissions);
    await tx
      .update(customRole)
      .set({ name: input.name, baseRole: input.baseRole, permissions })
      .where(eq(customRole.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.custom_role",
      entityType: "organization",
      entityId: ctx.orgId,
      before: {
        id: current.id,
        name: current.name,
        baseRole: current.baseRole,
        permissions: current.permissions,
      },
      after: { id: current.id, name: input.name, baseRole: input.baseRole, permissions },
    });
    const members = await tx
      .select({ userId: memberCustomRole.userId })
      .from(memberCustomRole)
      .where(eq(memberCustomRole.customRoleId, current.id));
    return { holders: members.map((m) => m.userId), before: current };
  });
  if (before.baseRole === input.baseRole) return;
  // Better Auth keeps the base role: the members' role follows it.
  const members = (await listMembers(ctx.orgId)).filter((m) => holders.includes(m.userId));
  for (const m of members) {
    await updateMemberRoles(
      ctx,
      headers,
      { memberId: m.id, roles: [input.baseRole] },
      {
        keepCustomRole: true,
      },
    );
  }
}

/** Archives a custom role nobody holds any more (`member:update`). */
export async function archiveCustomRole(ctx: TenantCtx, input: In<typeof archiveCustomRoleSchema>) {
  assertCan(ctx, "member:update");
  await withTenant(ctx, async (tx) => {
    const [held] = await tx
      .select({ id: memberCustomRole.id })
      .from(memberCustomRole)
      .where(eq(memberCustomRole.customRoleId, input.customRoleId))
      .limit(1);
    if (held) throw new AppError("CONFLICT", "customRoles.errors.held");
    const archived = await tx
      .update(customRole)
      .set({ archivedAt: new Date() })
      .where(and(eq(customRole.id, input.customRoleId), isNull(customRole.archivedAt)))
      .returning({ name: customRole.name });
    if (archived.length === 0) throw new AppError("NOT_FOUND");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.custom_role_archive",
      entityType: "organization",
      entityId: ctx.orgId,
      before: { id: input.customRoleId, name: archived[0]?.name },
    });
  });
}

/**
 * Gives a member a custom role (their Better Auth role becomes its base role) or takes it
 * back (they keep their current role). Never the gérant. Audited `member.custom_role`.
 */
export async function assignCustomRole(
  ctx: TenantCtx,
  headers: Headers,
  input: In<typeof assignCustomRoleSchema>,
) {
  assertCan(ctx, "member:update");
  const target = await getMember(ctx.orgId, input.memberId);
  if (!target) throw new AppError("NOT_FOUND");
  if (target.roles.includes("owner")) throw new AppError("FORBIDDEN", "members.ownerLocked");
  const role = input.customRoleId
    ? await withTenant(ctx, async (tx) => {
        const [row] = await tx
          .select()
          .from(customRole)
          .where(and(eq(customRole.id, input.customRoleId ?? ""), isNull(customRole.archivedAt)));
        if (!row) throw new AppError("NOT_FOUND");
        return row;
      })
    : null;
  if (role) {
    await updateMemberRoles(
      ctx,
      headers,
      { memberId: target.id, roles: [baseRole(role.baseRole)] },
      { keepCustomRole: true },
    );
  }
  await withTenant(ctx, async (tx) => {
    await tx.delete(memberCustomRole).where(eq(memberCustomRole.userId, target.userId));
    if (role) {
      await tx.insert(memberCustomRole).values({
        organizationId: ctx.orgId,
        userId: target.userId,
        customRoleId: role.id,
        assignedBy: ctx.userId,
      });
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "member.custom_role",
      entityType: "member",
      entityId: target.id,
      after: { customRole: role ? { id: role.id, name: role.name } : null },
    });
  });
}
