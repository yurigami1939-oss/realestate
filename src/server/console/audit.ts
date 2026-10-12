import "server-only";

import type { ConsoleTx } from "@/db/console-client";
import { consoleAuditLog } from "@/db/schema";
import { toJson } from "@/server/audit/record-audit";

import type { OperatorCtx } from "./context";

export type ConsoleAuditEntry = {
  /** Semantic action: `<entity>.<verb>`, e.g. `subscription.create`. */
  action: string;
  billingAccountId?: string | null;
  organizationId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

/** Appends to the console's audit trail, in the transaction that makes the change. */
export async function recordConsoleAudit(
  tx: ConsoleTx,
  ctx: OperatorCtx,
  entry: ConsoleAuditEntry,
): Promise<void> {
  await tx.insert(consoleAuditLog).values({
    actorUserId: ctx.userId,
    action: entry.action,
    billingAccountId: entry.billingAccountId ?? null,
    organizationId: entry.organizationId ?? null,
    before: toJson(entry.before),
    after: toJson(entry.after),
    reason: entry.reason ?? null,
  });
}
