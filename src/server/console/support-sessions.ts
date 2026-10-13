import "server-only";

import { and, desc, eq, gt, sql } from "drizzle-orm";

import { consoleDb } from "@/db/console-client";
import { consoleAuditLog } from "@/db/schema";

/** A support session starts within this delay of its recorded reason (CLAUDE.console.md §12). */
export const SUPPORT_START_WINDOW_SECONDS = 120;

/**
 * The organization of the support session an operator just recorded for this member
 * (`support.start` in the console's trail, within two minutes), or null: Better Auth's
 * impersonation opens a session on it, and refuses one nobody recorded a reason for.
 */
export async function pendingSupportOrganization(
  operatorId: string,
  memberUserId: string,
): Promise<string | null> {
  const [row] = await consoleDb
    .select({ organizationId: consoleAuditLog.organizationId })
    .from(consoleAuditLog)
    .where(
      and(
        eq(consoleAuditLog.action, "support.start"),
        eq(consoleAuditLog.actorUserId, operatorId),
        sql`${consoleAuditLog.after} ->> 'userId' = ${memberUserId}`,
        gt(
          consoleAuditLog.createdAt,
          sql`now() - make_interval(secs => ${SUPPORT_START_WINDOW_SECONDS})`,
        ),
      ),
    )
    .orderBy(desc(consoleAuditLog.createdAt))
    .limit(1);
  return row?.organizationId ?? null;
}
