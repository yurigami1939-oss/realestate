import "server-only";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";

import { db } from "@/db/client";
import { member } from "@/db/schema";
import { defaultLocale, isLocale, type Locale } from "@/i18n/locales";
import { resourceAllowed } from "@/lib/modules";
import { can, parseRoles, type Permission, type Role } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { loadTenantAccess, type TenantAccess } from "@/server/entitlements/access";

import { loadCustomPermissions } from "@/server/organizations/custom-roles";

import { auth, type Session } from "./auth";

/** Everything a service needs to act on behalf of a member of one organization. */
export type TenantCtx = {
  userId: string;
  orgId: string;
  roles: Role[];
  /**
   * The exact permissions of the member's custom role, when the organization gave one
   * (CLAUDE.md §5 Auth & roles); null or absent: their roles decide.
   */
  permissions?: readonly Permission[] | null;
  locale: Locale;
  /**
   * What the organization's subscription allows (CLAUDE.console.md §4): its modules on, its
   * state. Always set for a request; contexts built by the seed and jobs leave it out (not
   * restricted).
   */
  access?: TenantAccess;
};

/** Current Better Auth session, or null. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Resolves the member's tenant context from the session. Cached per request.
 * The organization always comes from the session, never from client input.
 */
export const getTenantCtx = cache(async (): Promise<TenantCtx> => {
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

  const locale = session.user.locale;
  return {
    userId: session.user.id,
    orgId,
    roles: parseRoles(membership.role),
    // A custom role, when the organization gave one, decides the member's permissions.
    permissions: await loadCustomPermissions(orgId, session.user.id),
    locale: isLocale(locale) ? locale : defaultLocale,
    access: await loadTenantAccess(orgId),
  };
});

/** Service-layer permission check (CLAUDE.md §5). Throws FORBIDDEN. */
export function assertCan(
  ctx: Pick<TenantCtx, "roles" | "permissions" | "access">,
  permission: Permission,
): void {
  // A module switched off or not subscribed refuses its permissions (CLAUDE.console.md §5).
  if (ctx.access && !resourceAllowed(permission.split(":")[0] ?? "", ctx.access.modules)) {
    throw new AppError("FORBIDDEN", "errors.moduleOff", { details: { permission } });
  }
  if (!can(ctx, permission)) {
    throw new AppError("FORBIDDEN", "errors.FORBIDDEN", { details: { permission } });
  }
}
