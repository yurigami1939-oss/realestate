import "server-only";

import type { Tx } from "@/db/client";
import { auditLog } from "@/db/schema";
import type { TenantScope } from "@/db/tenant";

export type AuditEntry = {
  /** null for background jobs. */
  actorUserId: string | null;
  /** Semantic action: `<entity>.<verb>`, e.g. `receipt.cancel`, `unit.status_change`. */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
};

/** JSON-safe copy: bigint (money) becomes a decimal string of centimes, Date an ISO string. */
function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

/** Appends to audit_log. Call it with the transaction that performs the change. */
export async function recordAudit(tx: Tx, scope: TenantScope, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    organizationId: scope.orgId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: toJson(entry.before),
    after: toJson(entry.after),
    reason: entry.reason ?? null,
  });
}
