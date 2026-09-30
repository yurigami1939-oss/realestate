import "server-only";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";

import { db } from "@/db/client";
import { member } from "@/db/schema";
import { defaultLocale, isLocale, type Locale } from "@/i18n/locales";
import { can, parseRoles, type Permission, type Role } from "@/lib/permissions";
import { AppError } from "@/lib/result";

import { auth, type Session } from "./auth";

/** Everything a service needs to act on behalf of a member of one organization. */
export type TenantCtx = {
  userId: string;
  orgId: string;
  roles: Role[];
  locale: Locale;
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
    locale: isLocale(locale) ? locale : defaultLocale,
  };
});

/** Service-layer permission check (CLAUDE.md §5). Throws FORBIDDEN. */
export function assertCan(ctx: Pick<TenantCtx, "roles">, permission: Permission): void {
  if (!can(ctx.roles, permission)) {
    throw new AppError("FORBIDDEN", "errors.FORBIDDEN", { details: { permission } });
  }
}
