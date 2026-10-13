import "server-only";

import { and, count, eq, isNull, ne, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { project, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import type { TenantCtx } from "@/server/auth/session";

import { readAccess } from "./access";

/** The account's usage as last measured (`console.tenant_capacity()`, CLAUDE.console.md §7). */
export type MeasuredCapacity = {
  /** The other organizations of the account: their active units, last night. */
  othersActiveUnits: number;
  activeUnits: number;
  managedLots: number;
  storageBytes: number;
  measuredOn: string | null;
};

const none: MeasuredCapacity = {
  othersActiveUnits: 0,
  activeUnits: 0,
  managedLots: 0,
  storageBytes: 0,
  measuredOn: null,
};

/** Reads the account's last measured usage in an open tenant transaction. */
export async function readMeasuredCapacity(tx: Tx): Promise<MeasuredCapacity> {
  const { rows } = await tx.execute<{ data: MeasuredCapacity | null }>(
    sql`select console.tenant_capacity() as data`,
  );
  const data = rows[0]?.data;
  return data ? { ...none, ...data, storageBytes: Number(data.storageBytes) } : none;
}

/** The organization's own active units right now: live units not handed over, in projects not delivered. */
export async function countActiveUnits(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(unit)
    .innerJoin(project, eq(project.id, unit.projectId))
    .where(
      and(
        isNull(unit.deletedAt),
        isNull(project.deletedAt),
        ne(unit.status, "delivered"),
        ne(project.status, "delivered"),
      ),
    );
  return row?.n ?? 0;
}

/**
 * The plan's `active_units` cap, pooled over the account (CLAUDE.console.md §7): this
 * organization's live count, the other organizations' last snapshot and the units being added
 * must stay within it. CONFLICT `errors.planLimit` otherwise — only when adding capacity, never
 * for what runs on existing units. No cap: nothing checked.
 */
export async function assertActiveUnitsRoom(tx: Tx, adding: number): Promise<void> {
  if (adding <= 0) return;
  const room = await activeUnitsRoom(tx);
  if (room && adding > room.room) {
    throw new AppError("CONFLICT", "errors.planLimit", { details: { cap: room.cap } });
  }
}

/** How many active units the account may still add (null: no cap). */
export async function activeUnitsRoom(tx: Tx): Promise<{ cap: number; room: number } | null> {
  const cap = (await readAccess(tx)).limits?.activeUnits ?? null;
  if (cap === null) return null;
  const own = await countActiveUnits(tx);
  const { othersActiveUnits } = await readMeasuredCapacity(tx);
  return { cap, room: cap - own - othersActiveUnits };
}

/**
 * The subscription page's usage (CLAUDE.console.md §11): active units now (this organization's
 * live count plus the others' snapshot), managed lots and storage as last measured.
 */
export async function getUsage(ctx: TenantCtx) {
  return withTenant(ctx, async (tx) => {
    const measured = await readMeasuredCapacity(tx);
    const own = await countActiveUnits(tx);
    return {
      activeUnits: own + measured.othersActiveUnits,
      managedLots: measured.managedLots,
      storageBytes: measured.storageBytes,
      measuredOn: measured.measuredOn,
    };
  });
}
