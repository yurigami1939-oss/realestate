import "server-only";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import {
  budget,
  budgetLine,
  chargeCall,
  chargeCallLine,
  chargeCategory,
  chargePeriod,
  project,
  residence,
  staffMember,
  staffPay,
  supplierInvoice,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { type Centimes, sumCentimes } from "@/lib/money";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { chargeStatement, liveCalls, paidByUnit } from "./accounts";

const bigintSum = (column: unknown) =>
  sql<string>`coalesce(sum(${column}), 0)`.mapWith((v: string) => BigInt(v));

/**
 * Budget vs actual of a residence for a calendar year (CLAUDE.md §12): per charge category,
 * the budgeted amount, what the calls of that year asked for and what the supplier invoices of
 * that year cost (paid or not). The reserve fund block covers every year: called, collected
 * (derived from the payments), spent on works, balance.
 */
export async function getBudgetReport(ctx: TenantCtx, residenceId: string, year: number) {
  assertCan(ctx, "charge:read");
  if (!isUuid(residenceId)) return null;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ name: residence.name, projectName: project.name })
      .from(residence)
      .innerJoin(project, eq(project.id, residence.projectId))
      .where(and(eq(residence.id, residenceId), isNull(residence.deletedAt)));
    if (!row) return null;

    const [yearBudget] = await tx
      .select({ id: budget.id, status: budget.status })
      .from(budget)
      .where(and(eq(budget.residenceId, residenceId), eq(budget.year, year)));
    const budgeted = yearBudget
      ? await tx
          .select({ categoryId: budgetLine.categoryId, amount: budgetLine.amount })
          .from(budgetLine)
          .where(eq(budgetLine.budgetId, yearBudget.id))
      : [];
    const called = await tx
      .select({ categoryId: chargeCallLine.categoryId, amount: bigintSum(chargeCallLine.amount) })
      .from(chargeCallLine)
      .innerJoin(chargeCall, eq(chargeCall.id, chargeCallLine.callId))
      .innerJoin(chargePeriod, eq(chargePeriod.id, chargeCall.periodId))
      .where(
        and(
          eq(chargeCall.residenceId, residenceId),
          eq(chargePeriod.status, "issued"),
          eq(chargePeriod.year, year),
        ),
      )
      .groupBy(chargeCallLine.categoryId);
    const yearInvoices = sql`extract(year from ${supplierInvoice.invoiceOn}) = ${year}`;
    const spent = await tx
      .select({
        categoryId: supplierInvoice.categoryId,
        amount: bigintSum(supplierInvoice.amount),
        paid: sql<string>`coalesce(sum(${supplierInvoice.amount}) filter (where ${supplierInvoice.paidOn} is not null), 0)`.mapWith(
          (v: string) => BigInt(v),
        ),
      })
      .from(supplierInvoice)
      .where(
        and(
          eq(supplierInvoice.residenceId, residenceId),
          isNull(supplierInvoice.deletedAt),
          eq(supplierInvoice.fromReserve, false),
          yearInvoices,
        ),
      )
      .groupBy(supplierInvoice.categoryId);
    // Staff pay of the year, booked to each agent's category (cost = base + bonus − deduction).
    const cost = sql`${staffPay.baseAmount} + ${staffPay.bonus} - ${staffPay.deduction}`;
    const payroll = await tx
      .select({
        categoryId: staffMember.categoryId,
        amount: sql<string>`coalesce(sum(${cost}), 0)`.mapWith((v: string) => BigInt(v)),
        paid: sql<string>`coalesce(sum(${cost}) filter (where ${staffPay.paidOn} is not null), 0)`.mapWith(
          (v: string) => BigInt(v),
        ),
      })
      .from(staffPay)
      .innerJoin(staffMember, eq(staffMember.id, staffPay.staffId))
      .where(
        and(
          eq(staffMember.residenceId, residenceId),
          isNotNull(staffMember.categoryId),
          sql`extract(year from ${staffPay.month}) = ${year}`,
        ),
      )
      .groupBy(staffMember.categoryId);

    // Categories: live ones, plus deleted ones that still carry figures this year.
    const categories = await tx
      .select({
        id: chargeCategory.id,
        name: chargeCategory.name,
        deletedAt: chargeCategory.deletedAt,
      })
      .from(chargeCategory)
      .where(eq(chargeCategory.residenceId, residenceId))
      .orderBy(asc(chargeCategory.position), asc(chargeCategory.name));
    const lines = categories
      .map((c) => {
        const budgetAmount = budgeted.find((b) => b.categoryId === c.id)?.amount ?? 0n;
        const calledAmount = called.find((x) => x.categoryId === c.id)?.amount ?? 0n;
        const invoices = spent.find((x) => x.categoryId === c.id);
        const pay = payroll.find((x) => x.categoryId === c.id);
        const spentAmount = (invoices?.amount ?? 0n) + (pay?.amount ?? 0n);
        return {
          categoryId: c.id,
          name: c.name,
          budget: budgetAmount,
          called: calledAmount,
          /** Supplier invoices and staff pay of the year. */
          spent: spentAmount,
          paid: (invoices?.paid ?? 0n) + (pay?.paid ?? 0n),
          /** Budget left (negative = overrun). */
          variance: budgetAmount - spentAmount,
          live: c.deletedAt === null,
        };
      })
      .filter((l) => l.live || l.budget > 0n || l.called > 0n || l.spent > 0n);

    // Reserve fund, all years.
    const calls = await liveCalls(tx, residenceId);
    const paid = await paidByUnit(tx, residenceId);
    let reserveCollected: Centimes = 0n;
    for (const unitId of new Set(calls.map((c) => c.unitId))) {
      reserveCollected += chargeStatement(
        calls.filter((c) => c.unitId === unitId),
        paid.get(unitId) ?? 0n,
        today,
      ).reserveCollected;
    }
    const [works] = await tx
      .select({ amount: bigintSum(supplierInvoice.amount) })
      .from(supplierInvoice)
      .where(
        and(
          eq(supplierInvoice.residenceId, residenceId),
          isNull(supplierInvoice.deletedAt),
          eq(supplierInvoice.fromReserve, true),
        ),
      );
    const reserveSpent = works?.amount ?? 0n;

    return {
      residence: { id: residenceId, ...row },
      year,
      budgetStatus: yearBudget?.status ?? null,
      lines,
      totals: {
        budget: sumCentimes(lines.map((l) => l.budget)),
        called: sumCentimes(lines.map((l) => l.called)),
        spent: sumCentimes(lines.map((l) => l.spent)),
        paid: sumCentimes(lines.map((l) => l.paid)),
        variance: sumCentimes(lines.map((l) => l.variance)),
      },
      reserve: {
        called: sumCentimes(calls.map((c) => c.reserve)),
        collected: reserveCollected,
        spent: reserveSpent,
        balance: reserveCollected - reserveSpent,
      },
    };
  });
}

export type BudgetReport = NonNullable<Awaited<ReturnType<typeof getBudgetReport>>>;
