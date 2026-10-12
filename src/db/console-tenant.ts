import "server-only";

import { sql } from "drizzle-orm";

import { consoleDb, type ConsoleTx } from "./console-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Points an open console transaction at one organization (`app.current_org`, transaction-local):
 * its tenant rows (entitlement, audit trail) become visible and writable under RLS. Called again
 * for the next organization of the same transaction.
 */
export async function setConsoleTenant(tx: ConsoleTx, orgId: string): Promise<void> {
  if (!UUID.test(orgId)) throw new Error(`setConsoleTenant: invalid organization id "${orgId}"`);
  await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
}

/**
 * Runs `fn` in a console transaction scoped to one organization (CLAUDE.console.md §3): the
 * console's way to write a tenant row — never `BYPASSRLS`. Pass `tx` to join an open one.
 */
export async function withConsoleTenant<T>(
  orgId: string,
  fn: (tx: ConsoleTx) => Promise<T>,
  tx?: ConsoleTx,
): Promise<T> {
  if (tx) {
    await setConsoleTenant(tx, orgId);
    return fn(tx);
  }
  return consoleDb.transaction(async (trx) => {
    await setConsoleTenant(trx, orgId);
    return fn(trx);
  });
}
