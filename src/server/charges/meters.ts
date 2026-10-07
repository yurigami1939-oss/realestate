import "server-only";

import { and, asc, desc, eq, gt, isNull, lt, lte } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { meterReading, residence, residenceUnit, unit, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { consumptionLitres } from "@/lib/charges";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";

import type { deleteMeterReadingSchema, saveMeterReadingsSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** Compares two indexes in m³ as exact decimals. */
const above = (a: string, b: string) => consumptionLitres(b, a) > 0n;

/**
 * Each unit's water consumption on a day, in litres: between its two latest readings dated on
 * or before it (null when its meter was not read twice).
 */
export async function unitConsumptions(
  tx: Tx,
  residenceId: string,
  onDay: CalendarDate,
): Promise<Map<string, bigint | null>> {
  const rows = await tx
    .select({ unitId: meterReading.unitId, reading: meterReading.reading })
    .from(meterReading)
    .where(and(eq(meterReading.residenceId, residenceId), lte(meterReading.readOn, onDay)))
    .orderBy(asc(meterReading.unitId), desc(meterReading.readOn));
  const latest = new Map<string, string[]>();
  for (const row of rows) {
    const readings = latest.get(row.unitId) ?? [];
    if (readings.length < 2) readings.push(row.reading);
    latest.set(row.unitId, readings);
  }
  const consumptions = new Map<string, bigint | null>();
  for (const [unitId, [last, previous]] of latest) {
    consumptions.set(unitId, last && previous ? consumptionLitres(previous, last) : null);
  }
  return consumptions;
}

/**
 * Records a campaign of meter readings on a day (`charge:create`): one index per unit read
 * (blank = not read), never in the future, never below the unit's reading before that day nor
 * above its reading after it; a unit read again the same day is corrected. Audited
 * `meter_reading.save` on the residence.
 */
export async function saveMeterReadings(ctx: TenantCtx, input: In<typeof saveMeterReadingsSchema>) {
  assertCan(ctx, "charge:create");
  if (input.readOn > todayInAlgiers()) throw invalid("readOn", "charges.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    const home = await loadResidence(tx, input.residenceId, { forUpdate: true });
    const enrolled = new Set(
      (
        await tx
          .select({ unitId: residenceUnit.unitId })
          .from(residenceUnit)
          .where(eq(residenceUnit.residenceId, home.id))
      ).map((u) => u.unitId),
    );
    let saved = 0;
    for (const [index, entry] of input.readings.entries()) {
      if (entry.reading === null) continue;
      if (!enrolled.has(entry.unitId)) throw new AppError("NOT_FOUND");
      const scope = and(
        eq(meterReading.residenceId, home.id),
        eq(meterReading.unitId, entry.unitId),
      );
      const [before] = await tx
        .select({ reading: meterReading.reading })
        .from(meterReading)
        .where(and(scope, lt(meterReading.readOn, input.readOn)))
        .orderBy(desc(meterReading.readOn))
        .limit(1);
      const [after] = await tx
        .select({ reading: meterReading.reading })
        .from(meterReading)
        .where(and(scope, gt(meterReading.readOn, input.readOn)))
        .orderBy(asc(meterReading.readOn))
        .limit(1);
      if (
        (before && above(before.reading, entry.reading)) ||
        (after && above(entry.reading, after.reading))
      ) {
        throw invalid(`readings.${index}.reading`, "charges.meters.errors.backwards");
      }
      await tx
        .insert(meterReading)
        .values({
          organizationId: ctx.orgId,
          residenceId: home.id,
          unitId: entry.unitId,
          readOn: input.readOn,
          reading: entry.reading,
          createdBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [
            meterReading.organizationId,
            meterReading.residenceId,
            meterReading.unitId,
            meterReading.readOn,
          ],
          set: { reading: entry.reading, createdBy: ctx.userId, createdAt: new Date() },
        });
      saved += 1;
    }
    if (saved === 0) throw invalid("readings", "charges.meters.errors.nothingRead");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "meter_reading.save",
      entityType: "residence",
      entityId: home.id,
      after: { readOn: input.readOn, units: saved },
    });
    return { saved };
  });
}

/** Removes a reading typed by mistake (`charge:create`). Audited on the residence. */
export async function deleteMeterReading(
  ctx: TenantCtx,
  input: In<typeof deleteMeterReadingSchema>,
) {
  assertCan(ctx, "charge:create");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(meterReading).where(eq(meterReading.id, input.readingId));
    if (!row) throw new AppError("NOT_FOUND");
    await tx.delete(meterReading).where(eq(meterReading.id, row.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "meter_reading.delete",
      entityType: "residence",
      entityId: row.residenceId,
      before: { unitId: row.unitId, readOn: row.readOn, reading: row.reading },
    });
  });
}

/**
 * The meters of a residence (`charge:read`): each unit with its two latest readings and the
 * consumption between them, and the reading days so far.
 */
export async function getMeterBoard(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "charge:read");
  if (!isUuid(residenceId)) return null;
  return withTenant(ctx, async (tx) => {
    const [home] = await tx
      .select({ id: residence.id, name: residence.name })
      .from(residence)
      .where(and(eq(residence.id, residenceId), isNull(residence.deletedAt)));
    if (!home) return null;
    const units = await tx
      .select({ unitId: residenceUnit.unitId, code: unit.code, type: unit.type })
      .from(residenceUnit)
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .where(eq(residenceUnit.residenceId, home.id))
      .orderBy(asc(unit.code));
    const readings = await tx
      .select({
        id: meterReading.id,
        unitId: meterReading.unitId,
        readOn: meterReading.readOn,
        reading: meterReading.reading,
        createdByName: user.name,
      })
      .from(meterReading)
      .innerJoin(user, eq(user.id, meterReading.createdBy))
      .where(eq(meterReading.residenceId, home.id))
      .orderBy(desc(meterReading.readOn));
    return {
      residence: { id: home.id, name: home.name },
      units: units.map((u) => {
        const own = readings.filter((r) => r.unitId === u.unitId);
        const [last, previous] = own;
        return {
          ...u,
          last: last ?? null,
          previous: previous ?? null,
          consumption: last && previous ? consumptionLitres(previous.reading, last.reading) : null,
        };
      }),
      days: [...new Set(readings.map((r) => r.readOn))],
    };
  });
}

export type MeterBoard = NonNullable<Awaited<ReturnType<typeof getMeterBoard>>>;
