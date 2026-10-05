import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { rentPayment } from "@/db/schema";
import type { CalendarDate } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import { buildRentPeriods, type RentFrequency } from "@/lib/rentals";
import { computeStatement } from "@/lib/statement";

const NO_PENALTY = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };

export type LeaseTerms = {
  startOn: CalendarDate;
  durationMonths: number;
  frequency: RentFrequency;
  monthlyRent: Centimes;
  monthlyCharges: Centimes;
  endedOn: CalendarDate | null;
};

/** Valid payments of these leases, totalled per lease: rent and deposit apart. */
export async function leasePaid(
  tx: Tx,
  leaseIds: string[],
): Promise<Map<string, { rent: Centimes; deposit: Centimes }>> {
  const totals = new Map<string, { rent: Centimes; deposit: Centimes }>();
  if (leaseIds.length === 0) return totals;
  const rows = await tx
    .select({
      leaseId: rentPayment.leaseId,
      kind: rentPayment.kind,
      total: sql<string>`sum(${rentPayment.amount})`.mapWith(String),
    })
    .from(rentPayment)
    .where(and(inArray(rentPayment.leaseId, leaseIds), eq(rentPayment.status, "valid")))
    .groupBy(rentPayment.leaseId, rentPayment.kind);
  for (const row of rows) {
    const current = totals.get(row.leaseId) ?? { rent: 0n, deposit: 0n };
    current[row.kind] += BigInt(row.total);
    totals.set(row.leaseId, current);
  }
  return totals;
}

/**
 * Rent account of a lease (CLAUDE.md §7 Rentals), derived: the valid rent payments are applied
 * FIFO to its periods (oldest due first, no penalties); a lease ended early keeps only the
 * periods started by its last day.
 */
export function rentStatement(lease: LeaseTerms, rentPaid: Centimes, today: CalendarDate) {
  const periods = buildRentPeriods(lease);
  return computeStatement(
    periods.map((p) => ({ ...p, label: p.fromOn })),
    rentPaid,
    today,
    NO_PENALTY,
  );
}

export type RentStatement = ReturnType<typeof rentStatement>;
