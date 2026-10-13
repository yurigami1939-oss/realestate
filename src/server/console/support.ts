import "server-only";

import { eq, inArray } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { consoleDb } from "@/db/console-client";
import { setConsoleTenant } from "@/db/console-tenant";
import { accountOrganization, member, user } from "@/db/schema";
import { parseRoles, type Role } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { auth } from "@/server/auth/auth";

import { recordConsoleAudit } from "./audit";
import type { OperatorCtx } from "./context";

export type SupportMember = {
  organizationId: string;
  userId: string;
  name: string;
  email: string;
  roles: Role[];
};

/**
 * The members an operator may view an organization as (CLAUDE.console.md §12): its staff —
 * never a portal account —, the gérant first.
 */
export async function listSupportMembers(organizationIds: string[]): Promise<SupportMember[]> {
  if (organizationIds.length === 0) return [];
  const rows = await consoleDb
    .select({
      organizationId: member.organizationId,
      userId: member.userId,
      role: member.role,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(inArray(member.organizationId, organizationIds));
  return rows
    .map(({ role, ...row }) => ({ ...row, roles: parseRoles(role) }))
    .filter((m) => !m.roles.includes("resident"))
    .sort(
      (a, b) =>
        Number(b.roles.includes("owner")) - Number(a.roles.includes("owner")) ||
        a.name.localeCompare(b.name),
    );
}

/** The client account an organization belongs to. */
async function accountOf(organizationId: string): Promise<string | null> {
  const [row] = await consoleDb
    .select({ id: accountOrganization.billingAccountId })
    .from(accountOrganization)
    .where(eq(accountOrganization.organizationId, organizationId));
  return row?.id ?? null;
}

/** Both trails of a support session's start or end, in one console transaction. */
async function recordSupport(
  operator: OperatorCtx,
  entry: {
    console: "support.start" | "support.stop";
    tenant: "support.access" | "support.end";
    organizationId: string;
    billingAccountId: string | null;
    after: Record<string, unknown>;
    reason?: string | null;
  },
): Promise<void> {
  await consoleDb.transaction(async (trx) => {
    await recordConsoleAudit(trx, operator, {
      action: entry.console,
      billingAccountId: entry.billingAccountId,
      organizationId: entry.organizationId,
      after: entry.after,
      reason: entry.reason ?? null,
    });
    // The organization sees it in its own audit trail (labelled « Opérateur »).
    await setConsoleTenant(trx, entry.organizationId);
    await recordAudit(
      trx as unknown as Tx,
      { orgId: entry.organizationId },
      {
        actorUserId: operator.userId,
        action: entry.tenant,
        entityType: "organization",
        entityId: entry.organizationId,
        after: { operator: operator.name ?? null, ...entry.after },
        reason: entry.reason ?? undefined,
      },
    );
  });
}

/**
 * Starts a support session (CLAUDE.console.md §12): the operator views the organization as one
 * of its staff members, with a reason, for 60 minutes, read-only. Recorded in the console's trail
 * (`support.start`) and the organization's (`support.access`) first; then Better Auth opens the
 * member's session on that organization (`impersonateUser`, `headers`: the operator's request).
 */
export async function startSupportSession(
  operator: OperatorCtx & { userId: string },
  input: { organizationId: string; userId: string; reason: string },
  headers: Headers,
): Promise<{ headers: Headers }> {
  const target = (await listSupportMembers([input.organizationId])).find(
    (m) => m.userId === input.userId,
  );
  if (!target) throw new AppError("NOT_FOUND", "console.errors.supportMember");
  const billingAccountId = await accountOf(input.organizationId);
  if (!billingAccountId) throw new AppError("NOT_FOUND", "console.errors.accountUnknown");
  await recordSupport(operator, {
    console: "support.start",
    tenant: "support.access",
    organizationId: input.organizationId,
    billingAccountId,
    after: { userId: target.userId, member: target.name },
    reason: input.reason,
  });
  const opened = await auth.api.impersonateUser({
    body: { userId: target.userId },
    headers,
    returnHeaders: true,
  });
  // The member's session cookies (set on the response by Better Auth's Next.js plugin).
  return { headers: opened.headers };
}

/**
 * Ends the support session of this request (`headers`: the member's session the operator holds):
 * Better Auth gives the operator their own session back (`restored`), then the end is recorded in
 * both trails (`support.stop`, `support.end`). FORBIDDEN outside a support session.
 */
export async function stopSupportSession(headers: Headers): Promise<{ restored: boolean }> {
  const session = await auth.api.getSession({ headers });
  const operatorId = session?.session.impersonatedBy;
  if (!session || !operatorId) throw new AppError("FORBIDDEN");
  // The operator's session comes back from the admin cookie; without it (dropped), the member's
  // session is ended all the same and the operator signs in again. Recorded once it is over.
  let restored = true;
  try {
    await auth.api.stopImpersonating({ headers });
  } catch {
    restored = false;
    await auth.api.signOut({ headers });
  }
  const organizationId = session.session.activeOrganizationId;
  if (organizationId) {
    const [operator] = await consoleDb
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, operatorId));
    await recordSupport(
      { userId: operatorId, name: operator?.name },
      {
        console: "support.stop",
        tenant: "support.end",
        organizationId,
        billingAccountId: await accountOf(organizationId),
        after: { userId: session.user.id, member: session.user.name },
      },
    );
  }
  return { restored };
}
