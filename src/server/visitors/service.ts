import "server-only";

import { randomInt } from "node:crypto";

import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { residence, residenceUnit, resident, unit, visitorPass } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { AppError } from "@/lib/result";
import {
  PASS_CODE_ALPHABET,
  PASS_CODE_LENGTH,
  VISITOR_DAYS_AHEAD,
  VISITORS_PER_DAY,
} from "@/lib/visitors";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { type PortalCtx, portalScope } from "@/server/portal/context";
import { type PushActor, queuePush, residentAccounts } from "@/server/push/notify";
import { currentResident, loadResidence } from "@/server/residences/service";
import { timeOf } from "@/server/rooms/service";

import type { announceVisitorSchema, logVisitorSchema, visitorPassIdSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** A code no other visitor of the residence holds for the day. */
async function newCode(tx: Tx, residenceId: string, day: CalendarDate) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = Array.from(
      { length: PASS_CODE_LENGTH },
      () => PASS_CODE_ALPHABET[randomInt(PASS_CODE_ALPHABET.length)],
    ).join("");
    const [taken] = await tx
      .select({ id: visitorPass.id })
      .from(visitorPass)
      .where(
        and(
          eq(visitorPass.residenceId, residenceId),
          eq(visitorPass.expectedOn, day),
          eq(visitorPass.code, code),
        ),
      );
    if (!taken) return code;
  }
  throw new Error("newCode: no free code");
}

/** Tells the host's portal accounts that their visitor came. */
async function pushArrival(
  tx: Tx,
  actor: PushActor,
  pass: { residentId: string | null; unitId: string | null; residenceId: string },
  params: { visitor: string; time: string },
) {
  await queuePush(tx, actor, "visitor_arrived", async () => {
    let residentIds: string[] = pass.residentId ? [pass.residentId] : [];
    if (residentIds.length === 0 && pass.unitId) {
      const residents = await tx
        .select({ id: resident.id })
        .from(resident)
        .where(
          and(
            eq(resident.residenceId, pass.residenceId),
            eq(resident.unitId, pass.unitId),
            currentResident(todayInAlgiers()),
          ),
        );
      residentIds = residents.map((r) => r.id);
    }
    const accounts: string[] = [];
    for (const id of residentIds) accounts.push(...(await residentAccounts(tx, id)));
    return { userIds: accounts, params, url: "/portal/visitors" };
  });
}

/**
 * A resident announces a visitor from the portal (CLAUDE.md §7 visitors): at one of its units,
 * for a day from today to `VISITOR_DAYS_AHEAD` days ahead, `VISITORS_PER_DAY` a day at most; a
 * code to give at the gate.
 */
export async function announceVisitor(ctx: PortalCtx, input: In<typeof announceVisitorSchema>) {
  return withTenant(ctx, async (tx) => {
    const { residents } = await portalScope(tx, ctx);
    const host = residents.find((r) => r.unitId === input.unitId);
    if (!host) throw new AppError("NOT_FOUND");
    const today = todayInAlgiers();
    if (input.expectedOn < today) throw invalid("expectedOn", "visitors.errors.past");
    if (input.expectedOn > addDays(today, VISITOR_DAYS_AHEAD)) {
      throw invalid("expectedOn", "visitors.errors.tooFar");
    }
    const [already] = await tx
      .select({ n: count() })
      .from(visitorPass)
      .where(
        and(
          eq(visitorPass.createdBy, ctx.userId),
          eq(visitorPass.expectedOn, input.expectedOn),
          eq(visitorPass.status, "expected"),
        ),
      );
    if ((already?.n ?? 0) >= VISITORS_PER_DAY) {
      throw new AppError("CONFLICT", "visitors.errors.tooMany");
    }
    const [person] = await tx
      .select({ lastName: resident.lastName, firstName: resident.firstName })
      .from(resident)
      .where(eq(resident.id, host.id));
    const code = await newCode(tx, host.residenceId, input.expectedOn);
    const [row] = await tx
      .insert(visitorPass)
      .values({
        organizationId: ctx.orgId,
        residenceId: host.residenceId,
        unitId: input.unitId,
        residentId: host.id,
        hostName: person ? `${person.lastName} ${person.firstName}` : ctx.name,
        visitorName: input.visitorName,
        people: input.people,
        expectedOn: input.expectedOn,
        code,
        note: input.note,
        createdBy: ctx.userId,
      })
      .returning({ id: visitorPass.id });
    if (!row) throw new Error("announceVisitor: no row returned");
    return { id: row.id, code };
  });
}

/** The resident withdraws a visitor it announced, before they came. */
export async function cancelVisitor(ctx: PortalCtx, input: In<typeof visitorPassIdSchema>) {
  await withTenant(ctx, async (tx) => {
    const [pass] = await tx
      .select()
      .from(visitorPass)
      .where(and(eq(visitorPass.id, input.passId), eq(visitorPass.createdBy, ctx.userId)))
      .for("update");
    if (!pass) throw new AppError("NOT_FOUND");
    if (pass.status !== "expected") throw new AppError("CONFLICT", "visitors.errors.notExpected");
    await tx
      .update(visitorPass)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(visitorPass.id, pass.id));
  });
}

/**
 * The gate records an announced visitor's arrival (`visitor:update`: gérant, gestionnaire, or a
 * guard's custom role), on the day announced; the host is told. Audited without the name.
 */
export async function recordArrival(ctx: TenantCtx, input: In<typeof visitorPassIdSchema>) {
  assertCan(ctx, "visitor:update");
  await withTenant(ctx, async (tx) => {
    if (!isUuid(input.passId)) throw new AppError("NOT_FOUND");
    const [pass] = await tx
      .select()
      .from(visitorPass)
      .where(eq(visitorPass.id, input.passId))
      .for("update");
    if (!pass) throw new AppError("NOT_FOUND");
    if (pass.status !== "expected") throw new AppError("CONFLICT", "visitors.errors.notExpected");
    if (pass.expectedOn !== todayInAlgiers()) {
      throw new AppError("CONFLICT", "visitors.errors.notToday");
    }
    const arrivedAt = new Date();
    await tx
      .update(visitorPass)
      .set({ status: "arrived", arrivedAt, recordedBy: ctx.userId })
      .where(eq(visitorPass.id, pass.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "visitor.arrival",
      entityType: "residence",
      entityId: pass.residenceId,
      after: { pass: pass.id, host: pass.hostName, people: pass.people },
    });
    await pushArrival(tx, ctx, pass, { visitor: pass.visitorName, time: timeOf(arrivedAt) });
  });
}

/**
 * A visitor who came unannounced, logged by the gate as arrived now (at a unit of the residence,
 * or for the common areas); the unit's residents are told. Audited without the name.
 */
export async function logVisitor(ctx: TenantCtx, input: In<typeof logVisitorSchema>) {
  assertCan(ctx, "visitor:update");
  return withTenant(ctx, async (tx) => {
    await loadResidence(tx, input.residenceId);
    if (input.unitId) {
      const [member] = await tx
        .select({ unitId: residenceUnit.unitId })
        .from(residenceUnit)
        .where(
          and(
            eq(residenceUnit.residenceId, input.residenceId),
            eq(residenceUnit.unitId, input.unitId),
          ),
        );
      if (!member) throw invalid("unitId", "visitors.errors.unit");
    }
    const arrivedAt = new Date();
    const [row] = await tx
      .insert(visitorPass)
      .values({
        organizationId: ctx.orgId,
        residenceId: input.residenceId,
        unitId: input.unitId,
        hostName: input.hostName,
        visitorName: input.visitorName,
        people: input.people,
        expectedOn: todayInAlgiers(arrivedAt),
        note: input.note,
        status: "arrived",
        arrivedAt,
        recordedBy: ctx.userId,
        createdBy: ctx.userId,
      })
      .returning({ id: visitorPass.id });
    if (!row) throw new Error("logVisitor: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "visitor.log",
      entityType: "residence",
      entityId: input.residenceId,
      after: { pass: row.id, host: input.hostName, people: input.people },
    });
    await pushArrival(
      tx,
      ctx,
      { residentId: null, unitId: input.unitId, residenceId: input.residenceId },
      { visitor: input.visitorName, time: timeOf(arrivedAt) },
    );
    return { id: row.id };
  });
}

/**
 * The register of a day (`visitor:read`): the visitors expected (a code searched for first) and
 * those who came, with the units of the residence for unannounced ones.
 */
export async function listVisitors(
  ctx: TenantCtx,
  residenceId: string,
  options: { day: CalendarDate; code?: string | null },
) {
  assertCan(ctx, "visitor:read");
  if (!isUuid(residenceId)) return { passes: [], units: [] };
  return withTenant(ctx, async (tx) => {
    const code = options.code?.trim().toUpperCase() || null;
    const passes = await tx
      .select({
        id: visitorPass.id,
        unitCode: unit.code,
        hostName: visitorPass.hostName,
        visitorName: visitorPass.visitorName,
        people: visitorPass.people,
        expectedOn: visitorPass.expectedOn,
        code: visitorPass.code,
        note: visitorPass.note,
        status: visitorPass.status,
        arrivedAt: visitorPass.arrivedAt,
      })
      .from(visitorPass)
      .leftJoin(unit, eq(unit.id, visitorPass.unitId))
      .where(
        and(
          eq(visitorPass.residenceId, residenceId),
          eq(visitorPass.expectedOn, options.day),
          code ? eq(visitorPass.code, code) : undefined,
        ),
      )
      .orderBy(
        sql`case ${visitorPass.status} when 'expected' then 0 when 'arrived' then 1 else 2 end`,
        asc(visitorPass.arrivedAt),
        asc(visitorPass.createdAt),
      );
    const units = await tx
      .select({ id: unit.id, code: unit.code })
      .from(residenceUnit)
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .where(and(eq(residenceUnit.residenceId, residenceId), isNull(unit.deletedAt)))
      .orderBy(asc(unit.code));
    return { passes, units };
  });
}

/** The account's units (to announce at) and the visitors it announced over the last month. */
export async function listPortalVisitors(ctx: PortalCtx) {
  return withTenant(ctx, async (tx) => {
    const { residents } = await portalScope(tx, ctx);
    const unitIds = [...new Set(residents.flatMap((r) => (r.unitId ? [r.unitId] : [])))];
    const units =
      unitIds.length === 0
        ? []
        : await tx
            .select({ id: unit.id, code: unit.code, residenceName: residence.name })
            .from(unit)
            .innerJoin(residenceUnit, eq(residenceUnit.unitId, unit.id))
            .innerJoin(residence, eq(residence.id, residenceUnit.residenceId))
            .where(inArray(unit.id, unitIds))
            .orderBy(asc(residence.name), asc(unit.code));
    const passes = await tx
      .select({
        id: visitorPass.id,
        unitCode: unit.code,
        visitorName: visitorPass.visitorName,
        people: visitorPass.people,
        expectedOn: visitorPass.expectedOn,
        code: visitorPass.code,
        status: visitorPass.status,
        arrivedAt: visitorPass.arrivedAt,
      })
      .from(visitorPass)
      .leftJoin(unit, eq(unit.id, visitorPass.unitId))
      .where(
        and(
          eq(visitorPass.createdBy, ctx.userId),
          gte(visitorPass.expectedOn, addDays(todayInAlgiers(), -30)),
        ),
      )
      .orderBy(desc(visitorPass.expectedOn), desc(visitorPass.createdAt))
      .limit(40);
    return { units, passes };
  });
}
