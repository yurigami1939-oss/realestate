import "server-only";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { invitation, member, organization, portalLink, resident, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { env } from "@/env";
import { isPortalOnly, parseRoles } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleBuyer } from "@/server/buyers/access";
import { sendEmailLater } from "@/server/email/send-later";
import { portalInvitationEmail } from "@/server/email/templates";

/** Same lifetime as the staff invitations. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The record shown on the portal: a buyer file or a co-owner / occupant. */
export type PortalTarget = { kind: "buyer"; id: string } | { kind: "resident"; id: string };

const targetColumn = (target: PortalTarget) =>
  target.kind === "buyer"
    ? eq(portalLink.buyerId, target.id)
    : eq(portalLink.residentId, target.id);

/** The record's e-mail, once checked that the member manages the record. */
async function loadTarget(tx: Tx, ctx: TenantCtx, target: PortalTarget) {
  if (target.kind === "buyer") {
    assertCan(ctx, "buyer:update");
    const row = await loadVisibleBuyer(tx, ctx, target.id);
    return { email: row.email, residenceId: null };
  }
  assertCan(ctx, "residence:update");
  const [row] = await tx
    .select({ email: resident.email, residenceId: resident.residenceId })
    .from(resident)
    .where(and(eq(resident.id, target.id), isNull(resident.deletedAt)));
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/**
 * Invites a buyer, co-owner or occupant to the portal (CLAUDE.md §12): a portal invitation
 * (role `resident`) is e-mailed to the record's address and the record waits on that e-mail
 * until the account is created. When the address already belongs to a portal account of the
 * organization, the record joins it at once. Inviting again renews a pending invitation.
 */
export async function inviteToPortal(ctx: TenantCtx, target: PortalTarget) {
  assertCan(ctx, "portal:invite");
  const sent = await withTenant(ctx, async (tx) => {
    const record = await loadTarget(tx, ctx, target);
    const email = record.email?.trim().toLowerCase();
    if (!email) throw new AppError("VALIDATION", "portal.errors.noEmail");
    const [live] = await tx
      .select()
      .from(portalLink)
      .where(and(targetColumn(target), isNull(portalLink.revokedAt)))
      .for("update");
    if (live?.userId) throw new AppError("CONFLICT", "portal.errors.alreadyActive");

    const [account] = await tx
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      // `member` is scoped by Better Auth, not RLS: filter on the organization explicitly.
      .where(and(eq(member.organizationId, ctx.orgId), sql`lower(${user.email}) = ${email}`));
    if (account && !isPortalOnly(parseRoles(account.role))) {
      throw new AppError("CONFLICT", "portal.errors.staffEmail");
    }

    let invitationId: string | null = null;
    if (!account) {
      // `invitation` is Better Auth's table: the accept-invitation page handles the rest.
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      const [pending] = await tx
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, ctx.orgId),
            eq(invitation.email, email),
            eq(invitation.role, "resident"),
            eq(invitation.status, "pending"),
          ),
        );
      if (pending) {
        await tx
          .update(invitation)
          .set({ expiresAt, inviterId: ctx.userId })
          .where(eq(invitation.id, pending.id));
        invitationId = pending.id;
      } else {
        const [created] = await tx
          .insert(invitation)
          .values({
            organizationId: ctx.orgId,
            email,
            role: "resident",
            status: "pending",
            expiresAt,
            inviterId: ctx.userId,
          })
          .returning({ id: invitation.id });
        if (!created) throw new Error("inviteToPortal: no invitation returned");
        invitationId = created.id;
      }
    }

    const fields = { email, userId: account?.userId ?? null, invitationId };
    let linkId: string;
    if (live) {
      await tx.update(portalLink).set(fields).where(eq(portalLink.id, live.id));
      linkId = live.id;
    } else {
      const [row] = await tx
        .insert(portalLink)
        .values({
          ...fields,
          organizationId: ctx.orgId,
          buyerId: target.kind === "buyer" ? target.id : null,
          residentId: target.kind === "resident" ? target.id : null,
          createdBy: ctx.userId,
        })
        .returning({ id: portalLink.id });
      if (!row) throw new Error("inviteToPortal: no link returned");
      linkId = row.id;
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "portal.invite",
      entityType: "portal_link",
      entityId: linkId,
      after: { [target.kind === "buyer" ? "buyerId" : "residentId"]: target.id, email },
    });
    if (!invitationId) return null;
    const [names] = await tx
      .select({ organization: organization.name, inviter: user.name })
      .from(organization)
      .innerJoin(user, eq(user.id, ctx.userId))
      .where(eq(organization.id, ctx.orgId));
    return { invitationId, email, ...names };
  });
  if (!sent) return { status: "linked" as const };
  await sendEmailLater(
    portalInvitationEmail({
      to: sent.email,
      organization: sent.organization ?? "",
      inviter: sent.inviter ?? "",
      url: `${env.BETTER_AUTH_URL}/${ctx.locale}/accept-invitation/${sent.invitationId}`,
    }),
  );
  return { status: "invited" as const };
}

/**
 * Withdraws a record from the portal: its account no longer sees it. An invitation that no
 * other record waits on is cancelled.
 */
export async function revokePortalLink(ctx: TenantCtx, linkId: string) {
  assertCan(ctx, "portal:invite");
  await withTenant(ctx, async (tx) => {
    const [link] = await tx
      .select()
      .from(portalLink)
      .where(eq(portalLink.id, linkId))
      .for("update");
    if (!link) throw new AppError("NOT_FOUND");
    if (link.revokedAt) throw new AppError("CONFLICT", "portal.errors.revoked");
    await loadTarget(
      tx,
      ctx,
      link.buyerId
        ? { kind: "buyer", id: link.buyerId }
        : { kind: "resident", id: link.residentId ?? "" },
    );
    await tx
      .update(portalLink)
      .set({ revokedAt: new Date(), revokedBy: ctx.userId })
      .where(eq(portalLink.id, link.id));
    if (!link.userId && link.invitationId) {
      const [waiting] = await tx
        .select({ id: portalLink.id })
        .from(portalLink)
        .where(
          and(
            eq(portalLink.invitationId, link.invitationId),
            isNull(portalLink.revokedAt),
            ne(portalLink.id, link.id),
          ),
        );
      if (!waiting) {
        await tx
          .update(invitation)
          .set({ status: "canceled" })
          .where(and(eq(invitation.id, link.invitationId), eq(invitation.status, "pending")));
      }
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "portal.revoke",
      entityType: "portal_link",
      entityId: link.id,
      before: { email: link.email, active: link.userId !== null },
    });
  });
}

export type PortalAccessState = "active" | "invited" | "expired";

/** Live portal access of records (by buyer or resident id): its state and e-mail. */
export async function getPortalAccess(
  ctx: TenantCtx,
  targets: PortalTarget[],
): Promise<Map<string, PortalAccess>> {
  const buyerIds = targets.flatMap((t) => (t.kind === "buyer" ? [t.id] : []));
  const residentIds = targets.flatMap((t) => (t.kind === "resident" ? [t.id] : []));
  if (buyerIds.length === 0 && residentIds.length === 0) return new Map();
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: portalLink.id,
        buyerId: portalLink.buyerId,
        residentId: portalLink.residentId,
        email: portalLink.email,
        userId: portalLink.userId,
        createdAt: portalLink.createdAt,
        invitationStatus: invitation.status,
        expiresAt: invitation.expiresAt,
      })
      .from(portalLink)
      .leftJoin(invitation, eq(invitation.id, portalLink.invitationId))
      .where(
        and(
          isNull(portalLink.revokedAt),
          buyerIds.length > 0 && residentIds.length > 0
            ? sql`(${inArray(portalLink.buyerId, buyerIds)} or ${inArray(portalLink.residentId, residentIds)})`
            : buyerIds.length > 0
              ? inArray(portalLink.buyerId, buyerIds)
              : inArray(portalLink.residentId, residentIds),
        ),
      ),
  );
  const now = Date.now();
  return new Map(
    rows.map((r): [string, PortalAccess] => {
      const state: PortalAccessState = r.userId
        ? "active"
        : r.invitationStatus === "pending" && r.expiresAt && r.expiresAt.getTime() > now
          ? "invited"
          : "expired";
      return [
        r.buyerId ?? r.residentId ?? "",
        { linkId: r.id, email: r.email, state, since: r.createdAt },
      ];
    }),
  );
}

export type PortalAccess = {
  linkId: string;
  email: string;
  state: PortalAccessState;
  since: Date;
};
