import "server-only";

import { and, asc, eq, gt } from "drizzle-orm";

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
