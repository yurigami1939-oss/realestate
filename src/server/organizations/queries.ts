import "server-only";

import { and, asc, eq, gt, ne } from "drizzle-orm";

import { db } from "@/db/client";
import { invitation, member, organization, user } from "@/db/schema";
import { parseRoles, type Role } from "@/lib/permissions";

export type PendingInvitation = {
  id: string;
  email: string;
  roles: Role[];
  organizationName: string;
  inviterName: string;
};

/**
 * Public lookup for the accept-invitation page. Invitation ids are random UUIDs sent only
 * to the invitee's mailbox; only pending, unexpired invitations are returned.
 */
export async function getPendingInvitation(id: string): Promise<PendingInvitation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      organizationName: organization.name,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { ...row, roles: parseRoles(row.role) };
}

export type UserOrganization = { id: string; name: string; roles: Role[] };

/** Organizations the user belongs to, oldest membership first. */
export async function listUserOrganizations(userId: string): Promise<UserOrganization[]> {
  const rows = await db
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, roles: parseRoles(r.role) }));
}

export type MemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  roles: Role[];
  joinedAt: Date;
};

const memberColumns = {
  id: member.id,
  userId: member.userId,
  name: user.name,
  email: user.email,
  role: member.role,
  joinedAt: member.createdAt,
};

/** Staff of the organization: portal accounts (role `resident` only) are managed from their records. */
export async function listMembers(orgId: string): Promise<MemberRow[]> {
  const rows = await db
    .select(memberColumns)
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), ne(member.role, "resident")))
    .orderBy(asc(member.createdAt));
  return rows.map(({ role, ...r }) => ({ ...r, roles: parseRoles(role) }));
}

export async function getMember(orgId: string, memberId: string): Promise<MemberRow | null> {
  const [row] = await db
    .select(memberColumns)
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(member.id, memberId)))
    .limit(1);
  if (!row) return null;
  const { role, ...rest } = row;
  return { ...rest, roles: parseRoles(role) };
}

export type InvitationRow = { id: string; email: string; roles: Role[]; expiresAt: Date };

/** Pending staff invitations (portal invitations are shown on their records). */
export async function listPendingInvitations(orgId: string): Promise<InvitationRow[]> {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, orgId),
        eq(invitation.status, "pending"),
        ne(invitation.role, "resident"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(invitation.createdAt));
  return rows.map(({ role, ...r }) => ({ ...r, roles: parseRoles(role) }));
}
