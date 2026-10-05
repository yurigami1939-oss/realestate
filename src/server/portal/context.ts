import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { cache } from "react";

import { db, type Tx } from "@/db/client";
import { member, portalLink, resident } from "@/db/schema";
import { defaultLocale, isLocale, type Locale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { parseRoles } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { getSession } from "@/server/auth/session";
import { currentResident } from "@/server/residences/service";

/** A portal account acting in one organization (CLAUDE.md §5: own records only). */
export type PortalCtx = {
  userId: string;
  orgId: string;
  name: string;
  locale: Locale;
};

/** Resolves the portal account from the session; throws for staff and anonymous users. */
export const getPortalCtx = cache(async (): Promise<PortalCtx> => {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHENTICATED");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new AppError("FORBIDDEN", "errors.noActiveOrganization");
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, session.user.id)))
    .limit(1);
  if (!membership) throw new AppError("FORBIDDEN", "errors.noActiveOrganization");
  if (!parseRoles(membership.role).includes("resident")) throw new AppError("FORBIDDEN");
  const locale = session.user.locale;
  return {
    userId: session.user.id,
    orgId,
    name: session.user.name,
    locale: isLocale(locale) ? locale : defaultLocale,
  };
});

/**
 * What a portal account may see: its live links — buyer files, and co-owners / occupants
 * still current today (a former co-owner no longer sees the unit).
 */
export async function portalScope(tx: Tx, ctx: PortalCtx) {
  const links = await tx
    .select({ buyerId: portalLink.buyerId, residentId: portalLink.residentId })
    .from(portalLink)
    .where(and(eq(portalLink.userId, ctx.userId), isNull(portalLink.revokedAt)));
  const buyerIds = links.flatMap((l) => (l.buyerId ? [l.buyerId] : []));
  const residentIds = links.flatMap((l) => (l.residentId ? [l.residentId] : []));
  const residents =
    residentIds.length === 0
      ? []
      : await tx
          .select({
            id: resident.id,
            residenceId: resident.residenceId,
            unitId: resident.unitId,
            kind: resident.kind,
          })
          .from(resident)
          .where(and(inArray(resident.id, residentIds), currentResident(todayInAlgiers())));
  return { buyerIds, residents };
}

export type PortalScope = Awaited<ReturnType<typeof portalScope>>;
