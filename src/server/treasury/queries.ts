import "server-only";

import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  cashCount,
  chargePayment,
  lease,
  payment,
  receipt,
  reservation,
  residence,
  rentPayment,
  supplier,
  supplierInvoice,
  treasuryAccount,
  treasuryMovement,
  unit,
  user,
  worksContract,
  worksInvoice,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import type { Centimes } from "@/lib/money";
import type { PaymentMethod } from "@/lib/sales";
import { type MovementKind, runningBalance } from "@/lib/treasury";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { accountTotals, balanceOn } from "./balances";
import type { LedgerParams } from "./schemas";

/** Accounts with their balance today, open ones first (`treasury:read`). */
export async function listAccounts(ctx: TenantCtx) {
  assertCan(ctx, "treasury:read");
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const accounts = await tx
      .select()
      .from(treasuryAccount)
      .orderBy(
        sql`${treasuryAccount.closedOn} is not null`,
        asc(treasuryAccount.kind),
        desc(treasuryAccount.isDefault),
        asc(treasuryAccount.name),
      );
    const totals = await accountTotals(tx, today);
    return accounts.map((a) => ({
      ...a,
      ...(totals.get(a.id) ?? {
        balance: a.openingBalance,
        inOn: 0n,
        outOn: 0n,
        pendingCheques: 0n,
      }),
    }));
  });
}

export type AccountRow = Awaited<ReturnType<typeof listAccounts>>[number];

/**
 * Open accounts money may land on or leave (the payment forms' choices): for whoever records
 * collections, pays supplier invoices or contractors, or reads the treasury.
 */
export async function listAccountChoices(ctx: TenantCtx) {
  if (
    !(["payment:create", "supplier:update", "cost:pay", "treasury:read"] as const).some((p) =>
      can(ctx.roles, p),
    )
  ) {
    throw new AppError("FORBIDDEN");
  }
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: treasuryAccount.id,
        kind: treasuryAccount.kind,
        name: treasuryAccount.name,
        isDefault: treasuryAccount.isDefault,
      })
      .from(treasuryAccount)
      .where(isNull(treasuryAccount.closedOn))
      .orderBy(
        asc(treasuryAccount.kind),
        desc(treasuryAccount.isDefault),
        asc(treasuryAccount.name),
      ),
  );
}

export type AccountChoice = Awaited<ReturnType<typeof listAccountChoices>>[number];

/** One line of a ledger, whatever its source. */
export type LedgerLine = {
  key: string;
  on: CalendarDate;
  at: Date;
  source: "sale" | "charges" | "rent" | "works" | "retention" | "supplier" | MovementKind;
  label: string;
  /** Receipt number, movement reference… */
  reference: string | null;
  method: PaymentMethod | null;
  amountIn: Centimes;
  amountOut: Centimes;
  /** A manual movement (cancellable), else null. */
  movementId: string | null;
  /** The record behind a collection (sale, residence account, lease). */
  href: string | null;
  pendingCheque: boolean;
};

const counter = alias(treasuryAccount, "counter");

/**
 * An account's ledger over a period (`treasury:read`; the current month by default): the
 * balance before it, then every collection and live movement by day with the running balance,
 * and the cash counts of the period. Null for an unknown account.
 */
export async function getAccountLedger(ctx: TenantCtx, accountId: string, params: LedgerParams) {
  assertCan(ctx, "treasury:read");
  if (!isUuid(accountId)) return null;
  const today = todayInAlgiers();
  const to = params.to ?? today;
  const from = params.from ?? `${to.slice(0, 7)}-01`;
  return withTenant(ctx, async (tx) => {
    const [account] = await tx
      .select()
      .from(treasuryAccount)
      .where(eq(treasuryAccount.id, accountId));
    if (!account) return null;
    const start = from < account.openingOn ? account.openingOn : from;
    const before =
      start <= account.openingOn
        ? account.openingBalance
        : await balanceOn(tx, account.id, addDays(start, -1));

    const sales = await tx
      .select({
        id: payment.id,
        on: payment.paidOn,
        at: payment.createdAt,
        amount: payment.amount,
        method: payment.method,
        chequeClearedOn: payment.chequeClearedOn,
        payer: payment.payerName,
        receipt: receipt.number,
        legacyReceipt: payment.legacyReceipt,
        saleId: reservation.id,
        saleNumber: reservation.number,
        unitCode: unit.code,
      })
      .from(payment)
      .innerJoin(reservation, eq(reservation.id, payment.reservationId))
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .leftJoin(receipt, eq(receipt.paymentId, payment.id))
      .where(
        and(
          eq(payment.accountId, account.id),
          eq(payment.status, "valid"),
          gte(payment.paidOn, start),
          lte(payment.paidOn, to),
        ),
      );
    const charges = await tx
      .select({
        id: chargePayment.id,
        on: chargePayment.paidOn,
        at: chargePayment.createdAt,
        amount: chargePayment.amount,
        method: chargePayment.method,
        chequeClearedOn: chargePayment.chequeClearedOn,
        payer: chargePayment.payerName,
        receipt: chargePayment.receiptNumber,
        residenceId: chargePayment.residenceId,
        unitId: chargePayment.unitId,
        residenceName: residence.name,
        unitCode: unit.code,
      })
      .from(chargePayment)
      .innerJoin(residence, eq(residence.id, chargePayment.residenceId))
      .innerJoin(unit, eq(unit.id, chargePayment.unitId))
      .where(
        and(
          eq(chargePayment.accountId, account.id),
          eq(chargePayment.status, "valid"),
          gte(chargePayment.paidOn, start),
          lte(chargePayment.paidOn, to),
        ),
      );
    const rents = await tx
      .select({
        id: rentPayment.id,
        on: rentPayment.paidOn,
        at: rentPayment.createdAt,
        amount: rentPayment.amount,
        method: rentPayment.method,
        chequeClearedOn: rentPayment.chequeClearedOn,
        payer: rentPayment.payerName,
        receipt: rentPayment.receiptNumber,
        kind: rentPayment.kind,
        leaseId: lease.id,
        leaseNumber: lease.number,
      })
      .from(rentPayment)
      .innerJoin(lease, eq(lease.id, rentPayment.leaseId))
      .where(
        and(
          eq(rentPayment.accountId, account.id),
          eq(rentPayment.status, "valid"),
          gte(rentPayment.paidOn, start),
          lte(rentPayment.paidOn, to),
        ),
      );
    const movements = await tx
      .select({
        id: treasuryMovement.id,
        on: treasuryMovement.movedOn,
        at: treasuryMovement.createdAt,
        kind: treasuryMovement.kind,
        direction: treasuryMovement.direction,
        amount: treasuryMovement.amount,
        label: treasuryMovement.label,
        category: treasuryMovement.category,
        reference: treasuryMovement.reference,
        counterName: counter.name,
      })
      .from(treasuryMovement)
      .leftJoin(counter, eq(counter.id, treasuryMovement.counterAccountId))
      .where(
        and(
          eq(treasuryMovement.accountId, account.id),
          isNull(treasuryMovement.cancelledAt),
          gte(treasuryMovement.movedOn, start),
          lte(treasuryMovement.movedOn, to),
        ),
      );

    const works = await tx
      .select({
        id: worksInvoice.id,
        on: worksInvoice.paidOn,
        at: worksInvoice.createdAt,
        net: worksInvoice.net,
        method: worksInvoice.paymentMethod,
        reference: worksInvoice.paymentReference,
        position: worksInvoice.position,
        contractId: worksContract.id,
        projectId: worksContract.projectId,
        title: worksContract.title,
        supplierName: supplier.name,
      })
      .from(worksInvoice)
      .innerJoin(worksContract, eq(worksContract.id, worksInvoice.contractId))
      .innerJoin(supplier, eq(supplier.id, worksContract.supplierId))
      .where(
        and(
          eq(worksInvoice.accountId, account.id),
          gte(worksInvoice.paidOn, start),
          lte(worksInvoice.paidOn, to),
        ),
      );
    const retentions = await tx
      .select({
        id: worksContract.id,
        on: worksContract.retentionReleasedOn,
        at: worksContract.updatedAt,
        amount: worksContract.retentionReleased,
        method: worksContract.retentionMethod,
        reference: worksContract.retentionReference,
        projectId: worksContract.projectId,
        title: worksContract.title,
        supplierName: supplier.name,
      })
      .from(worksContract)
      .innerJoin(supplier, eq(supplier.id, worksContract.supplierId))
      .where(
        and(
          eq(worksContract.retentionAccountId, account.id),
          gte(worksContract.retentionReleasedOn, start),
          lte(worksContract.retentionReleasedOn, to),
        ),
      );
    const supplierPaid = await tx
      .select({
        id: supplierInvoice.id,
        on: supplierInvoice.paidOn,
        at: supplierInvoice.createdAt,
        amount: supplierInvoice.amount,
        method: supplierInvoice.paymentMethod,
        reference: supplierInvoice.paymentReference,
        number: supplierInvoice.number,
        label: supplierInvoice.label,
        supplierName: supplier.name,
      })
      .from(supplierInvoice)
      .innerJoin(supplier, eq(supplier.id, supplierInvoice.supplierId))
      .where(
        and(
          eq(supplierInvoice.accountId, account.id),
          isNull(supplierInvoice.deletedAt),
          gte(supplierInvoice.paidOn, start),
          lte(supplierInvoice.paidOn, to),
        ),
      );

    const lines: LedgerLine[] = [
      ...sales.map((p) => ({
        key: `sale:${p.id}`,
        on: p.on,
        at: p.at,
        source: "sale" as const,
        label: `${p.saleNumber} · ${p.unitCode} · ${p.payer}`,
        reference: p.receipt ?? p.legacyReceipt,
        method: p.method,
        amountIn: p.amount,
        amountOut: 0n,
        movementId: null,
        href: `/sales/${p.saleId}`,
        pendingCheque: p.method === "cheque" && p.chequeClearedOn === null,
      })),
      ...charges.map((p) => ({
        key: `charges:${p.id}`,
        on: p.on,
        at: p.at,
        source: "charges" as const,
        label: `${p.residenceName} · ${p.unitCode} · ${p.payer}`,
        reference: p.receipt,
        method: p.method,
        amountIn: p.amount,
        amountOut: 0n,
        movementId: null,
        href: `/residences/${p.residenceId}/accounts/${p.unitId}`,
        pendingCheque: p.method === "cheque" && p.chequeClearedOn === null,
      })),
      ...rents.map((p) => ({
        key: `rent:${p.id}`,
        on: p.on,
        at: p.at,
        source: "rent" as const,
        label: `${p.leaseNumber} · ${p.payer}`,
        reference: p.receipt,
        method: p.method,
        amountIn: p.amount,
        amountOut: 0n,
        movementId: null,
        href: `/rentals/${p.leaseId}`,
        pendingCheque: p.method === "cheque" && p.chequeClearedOn === null,
      })),
      ...works.map((w) => ({
        key: `works:${w.id}`,
        on: w.on ?? start,
        at: w.at,
        source: "works" as const,
        label: `${w.title} · ${w.supplierName} · n° ${w.position}`,
        reference: w.reference,
        method: w.method,
        amountIn: 0n,
        amountOut: w.net,
        movementId: null,
        href: `/projects/${w.projectId}/costs/${w.contractId}`,
        pendingCheque: false,
      })),
      ...retentions.map((r) => ({
        key: `retention:${r.id}`,
        on: r.on ?? start,
        at: r.at,
        source: "retention" as const,
        label: `${r.title} · ${r.supplierName}`,
        reference: r.reference,
        method: r.method,
        amountIn: 0n,
        amountOut: r.amount ?? 0n,
        movementId: null,
        href: `/projects/${r.projectId}/costs/${r.id}`,
        pendingCheque: false,
      })),
      ...supplierPaid.map((i) => ({
        key: `supplier:${i.id}`,
        on: i.on ?? start,
        at: i.at,
        source: "supplier" as const,
        label: `${i.supplierName} · ${i.number} · ${i.label}`,
        reference: i.reference,
        method: i.method,
        amountIn: 0n,
        amountOut: i.amount,
        movementId: null,
        href: null,
        pendingCheque: false,
      })),
      ...movements.map((m) => ({
        key: `movement:${m.id}`,
        on: m.on,
        at: m.at,
        source: m.kind,
        label: [m.label, m.category, m.counterName].filter(Boolean).join(" · "),
        reference: m.reference,
        method: null,
        amountIn: m.direction === "in" ? m.amount : 0n,
        amountOut: m.direction === "out" ? m.amount : 0n,
        movementId: m.kind === "adjustment" ? null : m.id,
        href: null,
        pendingCheque: false,
      })),
    ].sort((a, b) => (a.on === b.on ? a.at.getTime() - b.at.getTime() : a.on < b.on ? -1 : 1));
    const ledger = runningBalance(before, lines);

    const counts = await tx
      .select({
        id: cashCount.id,
        countedOn: cashCount.countedOn,
        expected: cashCount.expected,
        counted: cashCount.counted,
        difference: cashCount.difference,
        note: cashCount.note,
        countedByName: user.name,
        createdAt: cashCount.createdAt,
      })
      .from(cashCount)
      .innerJoin(user, eq(user.id, cashCount.countedBy))
      .where(eq(cashCount.accountId, account.id))
      .orderBy(desc(cashCount.countedOn), desc(cashCount.createdAt))
      .limit(10);
    const totals = (await accountTotals(tx, today, [account.id])).get(account.id);
    return {
      account,
      from: start,
      to,
      before,
      lines: ledger.lines,
      closing: ledger.balance,
      totalIn: lines.reduce((sum, l) => sum + l.amountIn, 0n),
      totalOut: lines.reduce((sum, l) => sum + l.amountOut, 0n),
      balance: totals?.balance ?? account.openingBalance,
      pendingCheques: totals?.pendingCheques ?? 0n,
      counts,
    };
  });
}

export type AccountLedger = NonNullable<Awaited<ReturnType<typeof getAccountLedger>>>;
