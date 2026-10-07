import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { chargeCall, chargePeriod, lease, leaseChargeSettlement } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import { buildRentPeriods, provisionsOfYear, type RentPeriod } from "@/lib/rentals";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { leaseRevisions } from "./accounts";
import type { cancelChargeSettlementSchema, settleLeaseChargesSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** The months of the lease's periods starting in a year (at most 12). */
function monthsOfYear(periods: readonly RentPeriod[], year: number) {
  const months = periods
    .filter((p) => p.fromOn.startsWith(`${year}-`))
    .reduce((sum, p) => sum + p.months, 0);
  return Math.min(months, 12);
}

/**
 * The unit's ordinary charges called per year: budget calls still issued, the reserve fund
 * left out (it stays the owner's).
 */
async function unitChargesByYear(tx: Tx, unitId: string): Promise<Map<number, Centimes>> {
  const rows = await tx
    .select({
      year: chargePeriod.year,
      total: sql<string>`sum(${chargeCall.amount} - ${chargeCall.reserve})`.mapWith(String),
    })
    .from(chargeCall)
    .innerJoin(chargePeriod, eq(chargePeriod.id, chargeCall.periodId))
    .where(
      and(
        eq(chargeCall.unitId, unitId),
        eq(chargePeriod.kind, "budget"),
        eq(chargePeriod.status, "issued"),
      ),
    )
    .groupBy(chargePeriod.year);
  return new Map(rows.map((r) => [r.year, BigInt(r.total)]));
}

/**
 * The years a lease's charges can be settled for (from its start to its last day, never after
 * the current year), each with the provisions billed by the periods starting in it and a
 * suggested actual amount: the unit's ordinary charges called that year (reserve fund aside)
 * for the months the lease covers, half-up. `settled`: a live settlement exists.
 */
export async function settlementChoices(
  tx: Tx,
  row: typeof lease.$inferSelect,
  today: CalendarDate,
) {
  const revisions = (await leaseRevisions(tx, [row.id])).get(row.id);
  const periods = buildRentPeriods({ ...row, revisions });
  const charges = await unitChargesByYear(tx, row.unitId);
  const live = await tx
    .select({ year: leaseChargeSettlement.year })
    .from(leaseChargeSettlement)
    .where(
      and(eq(leaseChargeSettlement.leaseId, row.id), isNull(leaseChargeSettlement.cancelledAt)),
    );
  const first = Number(row.startOn.slice(0, 4));
  const last = Math.min(Number((row.endedOn ?? row.endOn).slice(0, 4)), Number(today.slice(0, 4)));
  const years = [];
  for (let year = first; year <= last; year += 1) {
    const months = monthsOfYear(periods, year);
    if (months === 0) continue;
    const called = charges.get(year);
    years.push({
      year,
      months,
      provisions: provisionsOfYear(periods, year),
      suggested: called === undefined ? null : (called * BigInt(months) + 6n) / 12n,
      settled: live.some((s) => s.year === year),
    });
  }
  return years;
}

/**
 * Settles a year's charges of a lease (`lease:update`): the actual charges against the
 * provisions billed by the periods starting that year. A balance due from the tenant becomes a
 * line of the rent account due on `dueOn`; a balance in the tenant's favour is credited to it
 * (deducted from what is due). One live settlement per lease and year; audited on the lease.
 */
export async function settleLeaseCharges(
  ctx: TenantCtx,
  input: In<typeof settleLeaseChargesSchema>,
) {
  assertCan(ctx, "lease:update");
  const today = todayInAlgiers();
  if (input.dueOn < today) throw invalid("dueOn", "rentals.errors.settlementDue");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(lease).where(eq(lease.id, input.leaseId)).for("update");
    if (!row) throw new AppError("NOT_FOUND");
    const choice = (await settlementChoices(tx, row, today)).find((c) => c.year === input.year);
    if (!choice) throw invalid("year", "rentals.errors.settlementYear");
    if (choice.settled) throw invalid("year", "rentals.errors.settlementExists");
    const balance = input.actual - choice.provisions;
    const [settlement] = await tx
      .insert(leaseChargeSettlement)
      .values({
        organizationId: ctx.orgId,
        leaseId: row.id,
        year: input.year,
        provisions: choice.provisions,
        actual: input.actual,
        balance,
        dueOn: input.dueOn,
        note: input.note,
        createdBy: ctx.userId,
      })
      .returning({ id: leaseChargeSettlement.id });
    if (!settlement) throw new Error("settleLeaseCharges: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lease.charge_settlement",
      entityType: "lease",
      entityId: row.id,
      after: {
        year: input.year,
        provisions: choice.provisions,
        actual: input.actual,
        balance,
        dueOn: input.dueOn,
      },
      reason: input.note ?? undefined,
    });
    return { id: settlement.id, balance };
  });
}

/**
 * Cancels a charges settlement (`lease:update`, reason): it no longer counts in the rent
 * account (money paid on it goes to the next lines) and the year can be settled again. Audited.
 */
export async function cancelChargeSettlement(
  ctx: TenantCtx,
  input: In<typeof cancelChargeSettlementSchema>,
) {
  assertCan(ctx, "lease:update");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(leaseChargeSettlement)
      .where(eq(leaseChargeSettlement.id, input.settlementId));
    if (!row) throw new AppError("NOT_FOUND");
    if (row.cancelledAt) throw new AppError("CONFLICT", "rentals.errors.settlementCancelled");
    await tx
      .update(leaseChargeSettlement)
      .set({ cancelledAt: new Date(), cancellationReason: input.reason })
      .where(eq(leaseChargeSettlement.id, row.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lease.charge_settlement_cancel",
      entityType: "lease",
      entityId: row.leaseId,
      before: { year: row.year, balance: row.balance },
      reason: input.reason,
    });
    return { id: row.id };
  });
}
