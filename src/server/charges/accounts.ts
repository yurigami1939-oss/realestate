import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { chargeCall, chargePayment, chargePeriod } from "@/db/schema";
import type { CalendarDate } from "@/lib/dates";
import { type Centimes, sumCentimes } from "@/lib/money";
import { computeStatement } from "@/lib/statement";

const NO_PENALTY = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };

/** Calls of live periods (issued, not cancelled), by due date then number. */
export async function liveCalls(tx: Tx, residenceId: string, unitIds?: string[]) {
  return tx
    .select({
      id: chargeCall.id,
      unitId: chargeCall.unitId,
      number: chargeCall.number,
      dueOn: chargeCall.dueOn,
      amount: chargeCall.amount,
      reserve: chargeCall.reserve,
      pdfFileId: chargeCall.pdfFileId,
      periodId: chargeCall.periodId,
      year: chargePeriod.year,
      frequency: chargePeriod.frequency,
      periodIndex: chargePeriod.periodIndex,
    })
    .from(chargeCall)
    .innerJoin(chargePeriod, eq(chargePeriod.id, chargeCall.periodId))
    .where(
      and(
        eq(chargeCall.residenceId, residenceId),
        eq(chargePeriod.status, "issued"),
        unitIds ? inArray(chargeCall.unitId, unitIds) : undefined,
      ),
    )
    .orderBy(asc(chargeCall.dueOn), asc(chargeCall.number));
}

export type LiveCall = Awaited<ReturnType<typeof liveCalls>>[number];

/** Total of the valid charge payments of each unit. */
export async function paidByUnit(
  tx: Tx,
  residenceId: string,
  unitIds?: string[],
): Promise<Map<string, Centimes>> {
  const rows = await tx
    .select({
      unitId: chargePayment.unitId,
      total: sql<string>`sum(${chargePayment.amount})`.mapWith(String),
    })
    .from(chargePayment)
    .where(
      and(
        eq(chargePayment.residenceId, residenceId),
        eq(chargePayment.status, "valid"),
        unitIds ? inArray(chargePayment.unitId, unitIds) : undefined,
      ),
    )
    .groupBy(chargePayment.unitId);
  return new Map(rows.map((r) => [r.unitId, BigInt(r.total)]));
}

/**
 * Charges account of a unit (CLAUDE.md §7 Residence charges): the valid payments are applied
 * FIFO to its live calls (oldest due first, no penalties); what exceeds every call issued so far
 * is a credit for the next ones. The reserve fund collected is each call's reserve part in
 * proportion to what is paid on it.
 */
export function chargeStatement<T extends LiveCall>(
  calls: readonly T[],
  paid: Centimes,
  today: CalendarDate,
) {
  const statement = computeStatement(
    calls.map((call, index) => ({ ...call, position: index + 1, label: call.number })),
    paid,
    today,
    NO_PENALTY,
  );
  return {
    ...statement,
    /** Paid beyond every call issued so far. */
    credit: paid > statement.price ? paid - statement.price : 0n,
    reserveCalled: sumCentimes(calls.map((c) => c.reserve)),
    reserveCollected: sumCentimes(
      statement.lines.map((l) => (l.amount === 0n ? 0n : (l.reserve * l.paid) / l.amount)),
    ),
  };
}
