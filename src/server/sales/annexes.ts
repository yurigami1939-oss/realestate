import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { reservationAnnex, unit } from "@/db/schema";
import type { UnitStatus, UnitType } from "@/lib/inventory";
import type { Centimes } from "@/lib/money";
import { AppError } from "@/lib/result";
import { transitionUnit } from "@/server/inventory/transition-unit";

const invalid = (messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { annexUnitIds: [messageKey] } });

export type SaleAnnex = {
  unitId: string;
  code: string;
  type: UnitType;
  usableArea: string | null;
  listPrice: Centimes;
};

/** The live annexes of these sales (released ones left out), by sale, in code order. */
export async function saleAnnexes(
  tx: Tx,
  reservationIds: string[],
): Promise<Map<string, SaleAnnex[]>> {
  const bySale = new Map<string, SaleAnnex[]>();
  if (reservationIds.length === 0) return bySale;
  const rows = await tx
    .select({
      reservationId: reservationAnnex.reservationId,
      unitId: reservationAnnex.unitId,
      code: unit.code,
      type: unit.type,
      usableArea: unit.usableArea,
      listPrice: reservationAnnex.listPrice,
    })
    .from(reservationAnnex)
    .innerJoin(unit, eq(unit.id, reservationAnnex.unitId))
    .where(
      and(
        inArray(reservationAnnex.reservationId, reservationIds),
        isNull(reservationAnnex.releasedAt),
      ),
    )
    .orderBy(asc(unit.code));
  for (const { reservationId, ...annex } of rows) {
    bySale.set(reservationId, [...(bySale.get(reservationId) ?? []), annex]);
  }
  return bySale;
}

/**
 * The annex units chosen for a new sale, locked and checked: distinct, not the main unit, of
 * the same project, available and priced (CLAUDE.md §7 Reservations and VSP).
 */
export async function loadAnnexUnits(
  tx: Tx,
  unitIds: string[],
  sale: { mainUnitId: string; projectId: string },
): Promise<{ id: string; code: string; listPrice: Centimes }[]> {
  if (new Set(unitIds).size !== unitIds.length || unitIds.includes(sale.mainUnitId)) {
    throw invalid("sales.annexes.errors.duplicate");
  }
  const annexes = [];
  for (const unitId of unitIds) {
    const [row] = await tx
      .select({
        id: unit.id,
        code: unit.code,
        status: unit.status,
        projectId: unit.projectId,
        listPrice: unit.listPrice,
      })
      .from(unit)
      .where(and(eq(unit.id, unitId), isNull(unit.deletedAt)))
      .for("update");
    if (!row) throw new AppError("NOT_FOUND");
    if (row.projectId !== sale.projectId) throw invalid("sales.annexes.errors.otherProject");
    if (row.status !== "available") throw invalid("sales.annexes.errors.notAvailable");
    if (row.listPrice === null) throw invalid("sales.annexes.errors.notPriced");
    annexes.push({ id: row.id, code: row.code, listPrice: row.listPrice });
  }
  return annexes;
}

/**
 * Moves a sale's live annexes along with its main unit (reserved → sold → delivered, or back to
 * available); `release` frees them from the sale (a withdrawal or a termination).
 */
export async function moveAnnexes(
  tx: Tx,
  actor: { orgId: string; userId: string | null },
  reservationId: string,
  to: UnitStatus,
  ref: { refType: string; refId: string; reason?: string | null },
  options: { release?: boolean } = {},
) {
  const annexes = (await saleAnnexes(tx, [reservationId])).get(reservationId) ?? [];
  for (const annex of annexes) {
    await transitionUnit(tx, actor, annex.unitId, to, ref);
  }
  if (options.release && annexes.length > 0) {
    await tx
      .update(reservationAnnex)
      .set({ releasedAt: new Date() })
      .where(
        and(eq(reservationAnnex.reservationId, reservationId), isNull(reservationAnnex.releasedAt)),
      );
  }
  return annexes;
}
