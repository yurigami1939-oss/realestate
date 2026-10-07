import "server-only";

import { and, between, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  buyer,
  chargeCall,
  chargePayment,
  chargePeriod,
  handover,
  lease,
  leaseChargeSettlement,
  payment,
  rentPayment,
  reservation,
  reservationBuyer,
  residence,
  unit,
} from "@/db/schema";
import { type AccountingCodes, type TaxSettings, vatSplit } from "@/lib/accounting";
import { type CalendarDate, toCalendarDate } from "@/lib/dates";
import { applyRate, type Centimes } from "@/lib/money";
import { buildRentPeriods } from "@/lib/rentals";
import { leaseRevisions } from "@/server/rentals/accounts";

import type { AccountingEntryLine } from "./service";

/** What one nature of revenue amounts to over the period, reversals deducted. */
export type RevenueTotals = { ttc: Centimes; ht: Centimes; vat: Centimes };

const zero = (): RevenueTotals => ({ ttc: 0n, ht: 0n, vat: 0n });

/**
 * The G50 worksheet of a period: revenue by nature (sales, rents, charge calls) with the VAT
 * collected at the organization's rates, and the cash received (sales, charges, rents and
 * deposits) on which the stamp duty is computed at its rate. VAT on purchases, payroll taxes and
 * anything the app does not record are left to the accountant.
 */
export type G50Figures = {
  sales: RevenueTotals;
  rents: RevenueTotals;
  charges: RevenueTotals;
  vat: Centimes;
  cash: Centimes;
  stampDuty: Centimes;
  stampDutyBp: number;
};

type Entry = {
  journal: string;
  on: CalendarDate;
  piece: string;
  label: string;
  /** The receivable's account (clients, tenants, co-owners). */
  receivable: string;
  /** Revenue lines: account and amount (HT, VAT, reserve fund…). */
  credits: { account: string; amount: Centimes }[];
  /** A reversal swaps debit and credit. */
  reversal?: boolean;
};

function toLines(entry: Entry): AccountingEntryLine[] {
  const total = entry.credits.reduce((sum, c) => sum + c.amount, 0n);
  const base = { journal: entry.journal, on: entry.on, piece: entry.piece, label: entry.label };
  const side = (amount: Centimes, debit: boolean) =>
    debit === !entry.reversal ? { debit: amount, credit: 0n } : { debit: 0n, credit: amount };
  return [
    { ...base, account: entry.receivable, ...side(total, true) },
    ...entry.credits
      .filter((c) => c.amount !== 0n)
      .map((c) => ({ ...base, account: c.account, ...side(c.amount, false) })),
  ];
}

const inPeriod = (day: CalendarDate | null, from: CalendarDate, to: CalendarDate) =>
  day !== null && day >= from && day <= to;

/**
 * Revenue entries of a period (CLAUDE.md §7 Treasury, accounting export), on top of the
 * treasury flows: each sale at the VSP (or the handover PV, as set) — the buyer's receivable
 * against the sale's revenue and VAT — reversed when a sold sale is terminated; each rent
 * period on its due day and each charges settlement when made (reversed when cancelled); each
 * charge call when issued — the co-owner against the charges called and the reserve fund —
 * reversed when its period is cancelled. Returns the lines and the G50 worksheet's figures.
 */
export async function revenueEntries(
  tx: Tx,
  from: CalendarDate,
  to: CalendarDate,
  codes: AccountingCodes,
  tax: TaxSettings,
): Promise<{ lines: AccountingEntryLine[]; figures: G50Figures }> {
  const entries: Entry[] = [];
  const sales = zero();
  const rents = zero();
  const charges = zero();
  const add = (totals: RevenueTotals, ttc: Centimes, ht: Centimes, vat: Centimes, sign: bigint) => {
    totals.ttc += sign * ttc;
    totals.ht += sign * ht;
    totals.vat += sign * vat;
  };

  // ── Sales ────────────────────────────────────────────────────────────────
  const saleColumns = {
    id: reservation.id,
    number: reservation.number,
    saleNumber: reservation.saleNumber,
    saleSignedOn: reservation.saleSignedOn,
    status: reservation.status,
    endedOn: reservation.endedOn,
    price: reservation.price,
    unitCode: unit.code,
  };
  const recognized =
    tax.revenueEvent === "vsp"
      ? await tx
          .select({ ...saleColumns, on: reservation.saleSignedOn, piece: reservation.saleNumber })
          .from(reservation)
          .innerJoin(unit, eq(unit.id, reservation.unitId))
          .where(
            or(
              between(reservation.saleSignedOn, from, to),
              and(
                eq(reservation.status, "withdrawn"),
                isNotNull(reservation.saleSignedOn),
                between(reservation.endedOn, from, to),
              ),
            ),
          )
      : await tx
          .select({ ...saleColumns, on: handover.signedOn, piece: handover.number })
          .from(reservation)
          .innerJoin(unit, eq(unit.id, reservation.unitId))
          .innerJoin(handover, eq(handover.reservationId, reservation.id))
          .where(between(handover.signedOn, from, to));
  const saleIds = recognized.map((s) => s.id);
  const mainBuyers = new Map(
    (saleIds.length === 0
      ? []
      : await tx
          .select({
            reservationId: reservationBuyer.reservationId,
            lastName: buyer.lastName,
            firstName: buyer.firstName,
          })
          .from(reservationBuyer)
          .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
          .where(
            and(inArray(reservationBuyer.reservationId, saleIds), eq(reservationBuyer.position, 1)),
          )
    ).map((b) => [b.reservationId, `${b.lastName} ${b.firstName}`]),
  );
  for (const sale of recognized) {
    const { ht, vat } = vatSplit(sale.price, tax.vatSalesBp);
    const label = `Vente ${sale.unitCode} · ${mainBuyers.get(sale.id) ?? sale.number}`;
    const credits = [
      { account: codes.salesRevenue, amount: ht },
      { account: codes.vatCollected, amount: vat },
    ];
    const piece = sale.piece ?? sale.number;
    if (inPeriod(sale.on, from, to) && sale.on) {
      entries.push({
        journal: codes.salesJournal,
        on: sale.on,
        piece,
        label,
        receivable: codes.clients,
        credits,
      });
      add(sales, sale.price, ht, vat, 1n);
    }
    // A sold sale terminated: its revenue is cancelled on the day it ended.
    if (tax.revenueEvent === "vsp" && sale.status === "withdrawn" && sale.endedOn) {
      if (inPeriod(sale.endedOn, from, to)) {
        entries.push({
          journal: codes.salesJournal,
          on: sale.endedOn,
          piece,
          label: `Résiliation · ${label}`,
          receivable: codes.clients,
          credits,
          reversal: true,
        });
        add(sales, sale.price, ht, vat, -1n);
      }
    }
  }

  // ── Charge calls ─────────────────────────────────────────────────────────
  const calls = await tx
    .select({
      number: chargeCall.number,
      amount: chargeCall.amount,
      reserve: chargeCall.reserve,
      issuedOn: chargePeriod.issuedOn,
      cancelledAt: chargePeriod.cancelledAt,
      unitCode: unit.code,
      residenceName: residence.name,
    })
    .from(chargeCall)
    .innerJoin(chargePeriod, eq(chargePeriod.id, chargeCall.periodId))
    .innerJoin(residence, eq(residence.id, chargeCall.residenceId))
    .innerJoin(unit, eq(unit.id, chargeCall.unitId))
    .where(
      and(
        lte(chargePeriod.issuedOn, to),
        or(gte(chargePeriod.issuedOn, from), isNotNull(chargePeriod.cancelledAt)),
      ),
    );
  for (const call of calls) {
    const label = `Appel de charges ${call.residenceName} · ${call.unitCode}`;
    const credits = [
      { account: codes.chargesCalled, amount: call.amount - call.reserve },
      { account: codes.reserveFund, amount: call.reserve },
    ];
    const base = {
      journal: codes.chargesJournal,
      piece: call.number,
      receivable: codes.coOwners,
      credits,
    };
    if (inPeriod(call.issuedOn, from, to)) {
      entries.push({ ...base, on: call.issuedOn, label });
      add(charges, call.amount, call.amount, 0n, 1n);
    }
    const cancelledOn = call.cancelledAt ? toCalendarDate(call.cancelledAt) : null;
    if (cancelledOn && inPeriod(cancelledOn, from, to)) {
      entries.push({ ...base, on: cancelledOn, label: `Annulation · ${label}`, reversal: true });
      add(charges, call.amount, call.amount, 0n, -1n);
    }
  }

  // ── Rents ────────────────────────────────────────────────────────────────
  const leases = await tx.select().from(lease).where(lte(lease.startOn, to));
  const revisions = await leaseRevisions(
    tx,
    leases.map((l) => l.id),
  );
  const rentVat = (kind: string) =>
    kind === "commercial" ? tax.vatRentCommercialBp : tax.vatRentResidentialBp;
  for (const row of leases) {
    const periods = buildRentPeriods({ ...row, revisions: revisions.get(row.id) });
    for (const period of periods) {
      if (!inPeriod(period.dueOn, from, to)) continue;
      const { ht, vat } = vatSplit(period.amount, rentVat(row.kind));
      entries.push({
        journal: codes.salesJournal,
        on: period.dueOn,
        piece: row.number,
        label: `Loyer ${period.fromOn} – ${period.toOn} · ${row.tenantName}`,
        receivable: codes.tenants,
        credits: [
          { account: codes.rentRevenue, amount: ht },
          { account: codes.vatCollected, amount: vat },
        ],
      });
      add(rents, period.amount, ht, vat, 1n);
    }
  }
  const byLease = new Map(leases.map((l) => [l.id, l]));
  const settlements =
    leases.length === 0
      ? []
      : await tx
          .select()
          .from(leaseChargeSettlement)
          .where(
            inArray(
              leaseChargeSettlement.leaseId,
              leases.map((l) => l.id),
            ),
          );
  for (const settlement of settlements) {
    const owner = byLease.get(settlement.leaseId);
    if (!owner || settlement.balance === 0n) continue;
    const amount = settlement.balance > 0n ? settlement.balance : -settlement.balance;
    const { ht, vat } = vatSplit(amount, rentVat(owner.kind));
    // A balance due is revenue; a credit in the tenant's favour reduces it.
    const credit = settlement.balance < 0n;
    const base = {
      journal: codes.salesJournal,
      piece: owner.number,
      receivable: codes.tenants,
      credits: [
        { account: codes.rentRevenue, amount: ht },
        { account: codes.vatCollected, amount: vat },
      ],
    };
    const label = `Régularisation des charges ${settlement.year} · ${owner.tenantName}`;
    const madeOn = toCalendarDate(settlement.createdAt);
    if (inPeriod(madeOn, from, to)) {
      entries.push({ ...base, on: madeOn, label, reversal: credit });
      add(rents, amount, ht, vat, credit ? -1n : 1n);
    }
    const cancelledOn = settlement.cancelledAt ? toCalendarDate(settlement.cancelledAt) : null;
    if (cancelledOn && inPeriod(cancelledOn, from, to)) {
      entries.push({ ...base, on: cancelledOn, label: `Annulation · ${label}`, reversal: !credit });
      add(rents, amount, ht, vat, credit ? 1n : -1n);
    }
  }

  // ── Cash received (stamp duty base) ─────────────────────────────────────────
  const cashTotal = async (
    table: typeof payment | typeof chargePayment | typeof rentPayment,
  ): Promise<Centimes> => {
    const rows = await tx
      .select({ amount: table.amount })
      .from(table)
      .where(
        and(eq(table.method, "cash"), eq(table.status, "valid"), between(table.paidOn, from, to)),
      );
    return rows.reduce((sum, r) => sum + r.amount, 0n);
  };
  const cash =
    (await cashTotal(payment)) + (await cashTotal(chargePayment)) + (await cashTotal(rentPayment));

  return {
    lines: entries.flatMap(toLines),
    figures: {
      sales,
      rents,
      charges,
      vat: sales.vat + rents.vat,
      cash,
      stampDuty: applyRate(cash, tax.stampDutyBp),
      stampDutyBp: tax.stampDutyBp,
    },
  };
}
