import "server-only";

import { and, asc, desc, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  buyer,
  project,
  reservation,
  reservationBuyer,
  residence,
  residenceUnit,
  resident,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { allocate } from "@/lib/money";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type {
  addResidentSchema,
  createResidenceSchema,
  endResidentSchema,
  saveSharesSchema,
  updateResidenceSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** A live residence (locked when asked); NOT_FOUND otherwise. */
export async function loadResidence(
  tx: Tx,
  residenceId: string,
  options: { forUpdate?: boolean } = {},
) {
  const query = tx
    .select()
    .from(residence)
    .where(and(eq(residence.id, residenceId), isNull(residence.deletedAt)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** A resident is current on a day when the day falls in its period. */
export const currentResident = (day: string) =>
  and(
    isNull(resident.deletedAt),
    or(isNull(resident.sinceOn), sql`${resident.sinceOn} <= ${day}::date`),
    or(isNull(resident.untilOn), sql`${resident.untilOn} >= ${day}::date`),
  );

/**
 * Sets a residence up on a project (CLAUDE.md §12): its live units that are in no other
 * residence join it with 0 tantièmes, to be entered or split by living area. Audited.
 */
export async function createResidence(ctx: TenantCtx, input: In<typeof createResidenceSchema>) {
  assertCan(ctx, "residence:create");
  return withTenant(ctx, async (tx) => {
    const [target] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, input.projectId), isNull(project.deletedAt)));
    if (!target) throw invalid("projectId", "residences.errors.projectNotFound");
    const { projectId, reserveFund, ...fields } = input;
    const [row] = await tx
      .insert(residence)
      .values({
        ...fields,
        organizationId: ctx.orgId,
        projectId,
        reserveFundBp: reserveFund,
        createdBy: ctx.userId,
      })
      .returning({ id: residence.id });
    if (!row) throw new Error("createResidence: no row returned");
    // The quote-part entered on a unit (inventory) is its starting tantièmes.
    const units = await tx
      .select({ id: unit.id, share: unit.share })
      .from(unit)
      .where(
        and(
          eq(unit.projectId, projectId),
          isNull(unit.deletedAt),
          notExists(
            tx
              .select({ unitId: residenceUnit.unitId })
              .from(residenceUnit)
              .where(eq(residenceUnit.unitId, unit.id)),
          ),
        ),
      );
    if (units.length > 0) {
      await tx.insert(residenceUnit).values(
        units.map((u) => ({
          organizationId: ctx.orgId,
          residenceId: row.id,
          unitId: u.id,
          share: u.share ?? 0,
        })),
      );
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "residence.create",
      entityType: "residence",
      entityId: row.id,
      after: { ...input, units: units.length },
    });
    return { id: row.id, units: units.length };
  });
}

/** Residence settings (name, address, share basis, call frequency, reserve fund…). Audited. */
export async function updateResidence(ctx: TenantCtx, input: In<typeof updateResidenceSchema>) {
  assertCan(ctx, "residence:update");
  await withTenant(ctx, async (tx) => {
    const before = await loadResidence(tx, input.residenceId, { forUpdate: true });
    const { residenceId, reserveFund, ...fields } = input;
    await tx
      .update(residence)
      .set({ ...fields, reserveFundBp: reserveFund })
      .where(eq(residence.id, residenceId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "residence.update",
      entityType: "residence",
      entityId: residenceId,
      before,
      after: { ...fields, reserveFundBp: reserveFund },
    });
  });
}

async function residenceUnits(tx: Tx, residenceId: string) {
  return tx
    .select({
      unitId: residenceUnit.unitId,
      share: residenceUnit.share,
      livingArea: unit.livingArea,
      usableArea: unit.usableArea,
    })
    .from(residenceUnit)
    .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
    .where(eq(residenceUnit.residenceId, residenceId))
    .orderBy(asc(unit.code));
}

/** Writes the tantièmes that changed and audits them (they drive every charge split). */
async function writeShares(
  tx: Tx,
  ctx: TenantCtx,
  residenceId: string,
  shares: { unitId: string; share: number }[],
  how: "manual" | "area",
) {
  const current = await residenceUnits(tx, residenceId);
  const changes = shares.flatMap((s) => {
    const before = current.find((c) => c.unitId === s.unitId);
    if (!before) throw invalid("shares", "residences.errors.unitNotInResidence");
    return before.share === s.share ? [] : [{ unitId: s.unitId, from: before.share, to: s.share }];
  });
  for (const change of changes) {
    await tx
      .update(residenceUnit)
      .set({ share: change.to })
      .where(
        and(eq(residenceUnit.residenceId, residenceId), eq(residenceUnit.unitId, change.unitId)),
      );
  }
  if (changes.length > 0) {
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "residence.shares",
      entityType: "residence",
      entityId: residenceId,
      after: { how, changes },
    });
  }
  return { changed: changes.length };
}

/** Tantièmes entered by the manager, saved as a whole. */
export async function saveShares(ctx: TenantCtx, input: In<typeof saveSharesSchema>) {
  assertCan(ctx, "residence:update");
  return withTenant(ctx, async (tx) => {
    await loadResidence(tx, input.residenceId, { forUpdate: true });
    return writeShares(tx, ctx, input.residenceId, input.shares, "manual");
  });
}

/**
 * Splits the residence's share basis across its units in proportion to their area: living
 * area, or usable area for shops, offices, parking and storage (largest remainder: the parts
 * always sum to the basis); units without an area get 0.
 */
export async function distributeSharesByArea(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "residence:update");
  return withTenant(ctx, async (tx) => {
    const target = await loadResidence(tx, residenceId, { forUpdate: true });
    const units = await residenceUnits(tx, residenceId);
    const weights = units.map((u) => {
      const area = u.livingArea ?? u.usableArea;
      return area ? BigInt(Math.round(Number(area) * 100)) : 0n;
    });
    if (weights.every((w) => w === 0n)) {
      throw new AppError("CONFLICT", "residences.errors.noArea");
    }
    const parts = allocate(BigInt(target.shareBasis), weights);
    return writeShares(
      tx,
      ctx,
      residenceId,
      units.map((u, index) => ({ unitId: u.unitId, share: Number(parts[index] ?? 0n) })),
      "area",
    );
  });
}

/** Unsets the other current main resident of the same kind on the unit. */
async function clearMain(tx: Tx, unitId: string, kind: "co_owner" | "occupant") {
  await tx
    .update(resident)
    .set({ isMain: false })
    .where(
      and(
        eq(resident.unitId, unitId),
        eq(resident.kind, kind),
        eq(resident.isMain, true),
        isNull(resident.untilOn),
        isNull(resident.deletedAt),
      ),
    );
}

/** A co-owner or occupant of a unit of the residence. */
export async function addResident(ctx: TenantCtx, input: In<typeof addResidentSchema>) {
  assertCan(ctx, "residence:update");
  return withTenant(ctx, async (tx) => {
    await loadResidence(tx, input.residenceId);
    const [member] = await tx
      .select({ unitId: residenceUnit.unitId })
      .from(residenceUnit)
      .where(
        and(
          eq(residenceUnit.residenceId, input.residenceId),
          eq(residenceUnit.unitId, input.unitId),
        ),
      );
    if (!member) throw invalid("unitId", "residences.errors.unitNotInResidence");
    if (input.isMain) await clearMain(tx, input.unitId, input.kind);
    const [row] = await tx
      .insert(resident)
      .values({ ...input, organizationId: ctx.orgId, createdBy: ctx.userId })
      .returning({ id: resident.id });
    if (!row) throw new Error("addResident: no row returned");
    return { id: row.id };
  });
}

/** Ends an ownership or occupancy on a day (the unit is sold, the tenant leaves). */
export async function endResident(ctx: TenantCtx, input: In<typeof endResidentSchema>) {
  assertCan(ctx, "residence:update");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ sinceOn: resident.sinceOn, untilOn: resident.untilOn })
      .from(resident)
      .where(and(eq(resident.id, input.residentId), isNull(resident.deletedAt)))
      .for("update");
    if (!row) throw new AppError("NOT_FOUND");
    if (row.untilOn) throw new AppError("CONFLICT", "residences.errors.alreadyEnded");
    if (row.sinceOn && input.untilOn < row.sinceOn) {
      throw invalid("untilOn", "residences.errors.endBeforeStart");
    }
    await tx
      .update(resident)
      .set({ untilOn: input.untilOn, isMain: false })
      .where(eq(resident.id, input.residentId));
  });
}

/**
 * Co-owners from sales (CLAUDE.md §12): for every unit of the residence sold through the app
 * (VSP signed) and without a current co-owner, its buyers become co-owners — the main buyer
 * first — from the VSP date.
 */
export async function importSaleBuyers(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "residence:update");
  return withTenant(ctx, async (tx) => {
    await loadResidence(tx, residenceId, { forUpdate: true });
    const today = todayInAlgiers();
    const units = await tx
      .select({ unitId: residenceUnit.unitId })
      .from(residenceUnit)
      .where(eq(residenceUnit.residenceId, residenceId));
    const covered = new Set(
      (
        await tx
          .select({ unitId: resident.unitId })
          .from(resident)
          .where(
            and(
              eq(resident.residenceId, residenceId),
              eq(resident.kind, "co_owner"),
              currentResident(today),
            ),
          )
      ).map((r) => r.unitId),
    );
    const open = units.map((u) => u.unitId).filter((id) => !covered.has(id));
    if (open.length === 0) return { units: 0, coOwners: 0 };
    const sales = await tx
      .select({
        id: reservation.id,
        unitId: reservation.unitId,
        signedOn: reservation.saleSignedOn,
      })
      .from(reservation)
      .where(and(inArray(reservation.unitId, open), eq(reservation.status, "sold")))
      .orderBy(desc(reservation.saleSignedOn));
    let unitsDone = 0;
    let coOwners = 0;
    for (const unitId of open) {
      const sale = sales.find((s) => s.unitId === unitId);
      if (!sale) continue;
      const buyers = await tx
        .select({
          id: buyer.id,
          position: reservationBuyer.position,
          lastName: buyer.lastName,
          firstName: buyer.firstName,
          lastNameAr: buyer.lastNameAr,
          firstNameAr: buyer.firstNameAr,
          phone: buyer.phone,
          email: buyer.email,
          address: buyer.address,
        })
        .from(reservationBuyer)
        .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
        .where(eq(reservationBuyer.reservationId, sale.id))
        .orderBy(asc(reservationBuyer.position));
      for (const b of buyers) {
        await tx.insert(resident).values({
          organizationId: ctx.orgId,
          residenceId,
          unitId,
          kind: "co_owner",
          isMain: b.position === 1,
          lastName: b.lastName,
          firstName: b.firstName,
          lastNameAr: b.lastNameAr,
          firstNameAr: b.firstNameAr,
          phone: b.phone,
          email: b.email,
          address: b.address,
          buyerId: b.id,
          sinceOn: sale.signedOn,
          createdBy: ctx.userId,
        });
        coOwners += 1;
      }
      if (buyers.length > 0) unitsDone += 1;
    }
    return { units: unitsDone, coOwners };
  });
}
