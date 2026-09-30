import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { unit, unitStatusHistory } from "@/db/schema";
import { canTransition, type UnitStatus } from "@/lib/inventory";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";

export type TransitionActor = { orgId: string; userId: string | null };

export type TransitionOptions = {
  reason?: string | null;
  /** What caused the change, e.g. `reservation` + its id. */
  refType?: string;
  refId?: string;
};

/**
 * The ONLY writer of `unit.status` (CLAUDE.md §7). Locks the unit, validates the transition,
 * writes unit_status_history and audit_log — all in the caller's tenant transaction.
 * Permission checks belong to the calling service.
 */
export async function transitionUnit(
  tx: Tx,
  actor: TransitionActor,
  unitId: string,
  to: UnitStatus,
  options: TransitionOptions = {},
): Promise<{ from: UnitStatus; to: UnitStatus }> {
  const [current] = await tx
    .select({ status: unit.status, code: unit.code })
    .from(unit)
    .where(and(eq(unit.id, unitId), isNull(unit.deletedAt)))
    .for("update");
  if (!current) throw new AppError("NOT_FOUND");

  const from = current.status;
  if (!canTransition(from, to)) {
    throw new AppError("INVALID_TRANSITION", "errors.INVALID_TRANSITION", {
      details: { from, to, unit: current.code },
    });
  }

  await tx.update(unit).set({ status: to }).where(eq(unit.id, unitId));
  await tx.insert(unitStatusHistory).values({
    organizationId: actor.orgId,
    unitId,
    fromStatus: from,
    toStatus: to,
    reason: options.reason ?? null,
    refType: options.refType ?? null,
    refId: options.refId ?? null,
    actorUserId: actor.userId,
  });
  await recordAudit(tx, actor, {
    actorUserId: actor.userId,
    action: "unit.status_change",
    entityType: "unit",
    entityId: unitId,
    before: { status: from },
    after: {
      status: to,
      ...(options.refType ? { refType: options.refType, refId: options.refId } : {}),
    },
    reason: options.reason ?? undefined,
  });

  return { from, to };
}
