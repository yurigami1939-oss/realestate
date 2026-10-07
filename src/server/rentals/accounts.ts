import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { leaseChargeSettlement, leaseRevision, rentPayment } from "@/db/schema";
import type { CalendarDate } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import {
  buildRentPeriods,
  type ChargeSettlement,
  rentAccountLines,
  type RentFrequency,
  type RentRevision,
} from "@/lib/rentals";
import { computeStatement } from "@/lib/statement";

const NO_PENALTY = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };

export type LeaseTerms = {
  startOn: CalendarDate;
  durationMonths: number;
  frequency: RentFrequency;
  monthlyRent: Centimes;
  monthlyCharges: Centimes;
  endedOn: CalendarDate | null;
  /** Rent revisions, from `leaseRevisions` (none = the lease's amounts throughout). */
  revisions?: readonly RentRevision[];
  /** Yearly charges settlements, from `leaseSettlements`. */
  settlements?: readonly ChargeSettlement[];
};

/** The live charges settlements of these leases, by lease. */
export async function leaseSettlements(
  tx: Tx,
  leaseIds: string[],
): Promise<Map<string, ChargeSettlement[]>> {
  const byLease = new Map<string, ChargeSettlement[]>();
  if (leaseIds.length === 0) return byLease;
  const rows = await tx
    .select({
      leaseId: leaseChargeSettlement.leaseId,
      year: leaseChargeSettlement.year,
      balance: leaseChargeSettlement.balance,
      dueOn: leaseChargeSettlement.dueOn,
    })
    .from(leaseChargeSettlement)
    .where(
      and(
        inArray(leaseChargeSettlement.leaseId, leaseIds),
        isNull(leaseChargeSettlement.cancelledAt),
      ),
    );
  for (const { leaseId, ...settlement } of rows) {
    byLease.set(leaseId, [...(byLease.get(leaseId) ?? []), settlement]);
  }
  return byLease;
}

/** Revisions and settlements of these leases, as the terms' extras. */
export async function leaseExtras(tx: Tx, leaseIds: string[]) {
  const revisions = await leaseRevisions(tx, leaseIds);
  const settlements = await leaseSettlements(tx, leaseIds);
  return (leaseId: string) => ({
    revisions: revisions.get(leaseId),
    settlements: settlements.get(leaseId),
  });
}

/** The rent revisions of these leases, by lease, oldest first. */
export async function leaseRevisions(
  tx: Tx,
  leaseIds: string[],
): Promise<Map<string, RentRevision[]>> {
  const byLease = new Map<string, RentRevision[]>();
  if (leaseIds.length === 0) return byLease;
  const rows = await tx
    .select({
      leaseId: leaseRevision.leaseId,
      effectiveOn: leaseRevision.effectiveOn,
      monthlyRent: leaseRevision.monthlyRent,
      monthlyCharges: leaseRevision.monthlyCharges,
    })
    .from(leaseRevision)
    .where(inArray(leaseRevision.leaseId, leaseIds))
    .orderBy(leaseRevision.effectiveOn);
  for (const { leaseId, ...revision } of rows) {
    byLease.set(leaseId, [...(byLease.get(leaseId) ?? []), revision]);
  }
  return byLease;
}

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
  const { lines, credit } = rentAccountLines(buildRentPeriods(lease), lease.settlements);
  return computeStatement(
    lines.map((p) => ({ ...p, label: p.fromOn })),
    rentPaid + credit,
    today,
    NO_PENALTY,
  );
}

export type RentStatement = ReturnType<typeof rentStatement>;
