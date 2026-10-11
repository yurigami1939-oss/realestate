import "server-only";

import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { lease, leaseChargeSettlement, project, rentPayment, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { vatSplit } from "@/lib/accounting";
import { toCalendarDate } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import { buildRentPeriods, type LeaseKind, leaseKinds } from "@/lib/rentals";
import { loadTaxSettings } from "@/server/accounting/tax";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { leaseRevisions } from "./accounts";

/** HT and VAT of an amount TTC, a negative one (credits) split like its opposite. */
function split(ttc: Centimes, rateBp: number) {
  if (ttc >= 0n) return vatSplit(ttc, rateBp);
  const { ht, vat } = vatSplit(-ttc, rateBp);
  return { ht: -ht, vat: -vat };
}

type Totals = { due: Centimes; ht: Centimes; vat: Centimes; collected: Centimes; duty: Centimes };
const zero = (): Totals => ({ due: 0n, ht: 0n, vat: 0n, collected: 0n, duty: 0n });

/**
 * Rental taxes of a calendar year (CLAUDE.md §7 Rentals), for the accountant's declarations:
 * per lease, what fell due in the year — the rent periods starting in it and the charges
 * settlements made in it (a credit deducted), as in the accounting export — split into HT and
 * VAT at the organization's rate for its kind, the rent collected in the year, and its
 * registration (day, duties). Totals per lease kind. Nothing is declared by the app.
 */
export async function getRentalTaxes(ctx: TenantCtx, year: number) {
  assertCan(ctx, "lease:read");
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return withTenant(ctx, async (tx) => {
    const tax = await loadTaxSettings(tx, ctx.orgId);
    const rates: Record<LeaseKind, number> = {
      residential: tax.vatRentResidentialBp,
      commercial: tax.vatRentCommercialBp,
    };
    const leases = await tx
      .select({
        lease,
        unitCode: unit.code,
        projectName: project.name,
      })
      .from(lease)
      .innerJoin(unit, eq(unit.id, lease.unitId))
      .innerJoin(project, eq(project.id, lease.projectId))
      // Leases with nothing in the year are left out below.
      .where(lte(lease.startOn, to))
      .orderBy(asc(lease.kind), asc(lease.number));
    const ids = leases.map((l) => l.lease.id);
    const revisions = await leaseRevisions(tx, ids);
    const settlements =
      ids.length === 0
        ? []
        : await tx
            .select({
              leaseId: leaseChargeSettlement.leaseId,
              balance: leaseChargeSettlement.balance,
              createdAt: leaseChargeSettlement.createdAt,
            })
            .from(leaseChargeSettlement)
            .where(
              and(
                inArray(leaseChargeSettlement.leaseId, ids),
                isNull(leaseChargeSettlement.cancelledAt),
              ),
            );
    const collected = new Map(
      (ids.length === 0
        ? []
        : await tx
            .select({
              leaseId: rentPayment.leaseId,
              amount: sql<string>`sum(${rentPayment.amount})::text`,
            })
            .from(rentPayment)
            .where(
              and(
                inArray(rentPayment.leaseId, ids),
                eq(rentPayment.kind, "rent"),
                eq(rentPayment.status, "valid"),
                gte(rentPayment.paidOn, from),
                lte(rentPayment.paidOn, to),
              ),
            )
            .groupBy(rentPayment.leaseId)
      ).map((r) => [r.leaseId, BigInt(r.amount)]),
    );

    const inYear = (day: string) => day >= from && day <= to;
    const rows = leases.flatMap(({ lease: l, unitCode, projectName }) => {
      const periods = buildRentPeriods({ ...l, revisions: revisions.get(l.id) }).filter((p) =>
        inYear(p.dueOn),
      );
      const rents = periods.reduce((sum, p) => sum + p.amount, 0n);
      const regularized = settlements
        .filter((s) => s.leaseId === l.id && inYear(toCalendarDate(s.createdAt)))
        .reduce((sum, s) => sum + s.balance, 0n);
      const due = rents + regularized;
      const { ht, vat } = split(due, rates[l.kind]);
      const paid = collected.get(l.id) ?? 0n;
      const registeredInYear = l.registeredOn !== null && inYear(l.registeredOn);
      const duty = registeredInYear ? (l.registrationDuty ?? 0n) : 0n;
      if (due === 0n && paid === 0n && !registeredInYear) return [];
      return [
        {
          id: l.id,
          number: l.number,
          kind: l.kind,
          tenantName: l.tenantName,
          unitCode,
          projectName,
          periods: periods.length,
          rents,
          regularized,
          due,
          ht,
          vat,
          collected: paid,
          registeredOn: l.registeredOn,
          registrationReference: l.registrationReference,
          duty,
        },
      ];
    });

    const totals = Object.fromEntries(leaseKinds.map((k) => [k, zero()])) as Record<
      LeaseKind,
      Totals
    >;
    const all = zero();
    for (const row of rows) {
      for (const target of [totals[row.kind], all]) {
        target.due += row.due;
        target.ht += row.ht;
        target.vat += row.vat;
        target.collected += row.collected;
        target.duty += row.duty;
      }
    }
    return { year, rows, totals, all, rates };
  });
}

export type RentalTaxes = Awaited<ReturnType<typeof getRentalTaxes>>;
