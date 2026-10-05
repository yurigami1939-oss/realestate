import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { portalLink } from "@/db/schema";
import { withTenant } from "@/db/tenant";

/**
 * A portal invitation was accepted (Better Auth hook): the records waiting on the account's
 * e-mail are shown to it from now on.
 */
export async function linkPortalAccount(
  organizationId: string,
  user: { id: string; email: string },
): Promise<number> {
  const linked = await withTenant({ orgId: organizationId }, (tx) =>
    tx
      .update(portalLink)
      .set({ userId: user.id })
      .where(
        and(
          eq(portalLink.email, user.email.toLowerCase()),
          isNull(portalLink.userId),
          isNull(portalLink.revokedAt),
        ),
      )
      .returning({ id: portalLink.id }),
  );
  return linked.length;
}
