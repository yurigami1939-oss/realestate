import "server-only";

import { sql } from "drizzle-orm";

import { db, type Tx } from "./client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantScope = { orgId: string };

/**
 * Runs `fn` in a transaction scoped to one organization: sets `app.current_org`
 * (transaction-local, safe with pooling) so RLS policies only expose that tenant's rows.
 *
 * Pass `tx` to join a transaction the caller already opened with `withTenant`
 * for the same organization (composition of services).
 */
export async function withTenant<T>(
  scope: TenantScope,
  fn: (tx: Tx) => Promise<T>,
  tx?: Tx,
): Promise<T> {
  if (tx) return fn(tx);
  if (!UUID.test(scope.orgId))
    throw new Error(`withTenant: invalid organization id "${scope.orgId}"`);
  return db.transaction(async (trx) => {
    await trx.execute(sql`select set_config('app.current_org', ${scope.orgId}, true)`);
    return fn(trx);
  });
}
