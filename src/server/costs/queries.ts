import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  installment,
  payment,
  project,
  projectBudgetLine,
  reservation,
  supplier,
  treasuryAccount,
  unit,
  worksContract,
  worksInvoice,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  costCategories,
  type MonthKey,
  monthOf,
  nextMonths,
  projectMargin,
  spreadRemaining,
  type WorksContractState,
} from "@/lib/costs";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import type { Centimes } from "@/lib/money";
import { computeStatement } from "@/lib/statement";
import { assertCan, type TenantCtx } from "@/server/auth/session";

const NO_PENALTIES = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };
/** Months shown in the cash-flow forecast. */
export const FORECAST_MONTHS = 12;

const contractState = (c: {
  terminatedOn: string | null;
  finalAcceptanceOn: string | null;
  provisionalAcceptanceOn: string | null;
}): WorksContractState =>
  c.terminatedOn
    ? "terminated"
    : c.finalAcceptanceOn
      ? "final"
      : c.provisionalAcceptanceOn
        ? "provisional"
        : "active";

/** The project's contracts with what is invoiced, paid and retained on each. */
async function loadContracts(tx: Tx, projectId: string) {
  const contracts = await tx
    .select({ contract: worksContract, supplierName: supplier.name })
    .from(worksContract)
    .innerJoin(supplier, eq(supplier.id, worksContract.supplierId))
    .where(and(eq(worksContract.projectId, projectId), isNull(worksContract.deletedAt)))
    .orderBy(asc(worksContract.signedOn), asc(worksContract.createdAt));
  const ids = contracts.map((c) => c.contract.id);
  const invoices =
    ids.length === 0
      ? []
      : await tx.select().from(worksInvoice).where(inArray(worksInvoice.contractId, ids));
  return contracts.map(({ contract, supplierName }) => {
    const own = invoices.filter((i) => i.contractId === contract.id);
    const sum = (pick: (i: (typeof own)[number]) => Centimes) =>
      own.reduce((total, i) => total + pick(i), 0n);
    const invoiced = sum((i) => i.gross);
    const retention = sum((i) => i.retention);
    const paidNet = sum((i) => (i.paidOn ? i.net : 0n));
    const released = contract.retentionReleased ?? 0n;
    const state = contractState(contract);
    return {
      ...contract,
      supplierName,
      state,
      invoices: own,
      invoiced,
      retention,
      paid: paidNet + released,
      /** Net payable not paid yet (progress invoices). */
      unpaid: sum((i) => (i.paidOn ? 0n : i.net)),
      /** Retention still held (until released). */
      retentionHeld: contract.retentionReleasedOn ? 0n : retention,
      /** What the contract still commits (nothing once terminated). */
      committed: state === "terminated" ? invoiced : contract.amount,
      remaining: state === "terminated" ? 0n : contract.amount - invoiced,
    };
  });
}

export type ProjectContract = Awaited<ReturnType<typeof loadContracts>>[number];

/**
 * The costs of a project (`cost:read`, CLAUDE.md §7 Construction costs): its budget, contracts
 * and progress invoices, per category budget / committed / invoiced / paid, the margin
 * (expected revenue against forecast cost) and a 12-month cash-flow forecast (expected
 * collections from the schedules against expected spending). Null for an unknown project.
 */
export async function getProjectCosts(ctx: TenantCtx, projectId: string) {
  assertCan(ctx, "cost:read");
  if (!isUuid(projectId)) return null;
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [owner] = await tx
      .select({ id: project.id, name: project.name, code: project.code })
      .from(project)
      .where(and(eq(project.id, projectId), isNull(project.deletedAt)));
    if (!owner) return null;
    const budget = await tx
      .select()
      .from(projectBudgetLine)
      .where(eq(projectBudgetLine.projectId, projectId))
      .orderBy(asc(projectBudgetLine.position));
    const contracts = await loadContracts(tx, projectId);

    const byCategory = costCategories.map((category) => {
      const own = contracts.filter((c) => c.category === category);
      const total = (pick: (c: ProjectContract) => Centimes) =>
        own.reduce((sum, c) => sum + pick(c), 0n);
      return {
        category,
        budget: budget
          .filter((l) => l.category === category)
          .reduce((sum, l) => sum + l.amount, 0n),
        committed: total((c) => c.committed),
        invoiced: total((c) => c.invoiced),
        paid: total((c) => c.paid),
      };
    });

    // Revenue: the live sales and the stock still for sale.
    const sales = await tx
      .select({ id: reservation.id, price: reservation.price })
      .from(reservation)
      .where(
        and(
          eq(reservation.projectId, projectId),
          inArray(reservation.status, ["reserved", "sold"]),
        ),
      );
    const saleIds = sales.map((s) => s.id);
    const [collected] =
      saleIds.length === 0
        ? [{ total: "0" }]
        : await tx
            .select({ total: sql<string>`coalesce(sum(${payment.amount}), 0)::text` })
            .from(payment)
            .where(and(inArray(payment.reservationId, saleIds), eq(payment.status, "valid")));
    const [stock] = await tx
      .select({ total: sql<string>`coalesce(sum(${unit.listPrice}), 0)::text` })
      .from(unit)
      .where(
        and(
          eq(unit.projectId, projectId),
          isNull(unit.deletedAt),
          inArray(unit.status, ["available", "optioned"]),
        ),
      );
    const signed = sales.reduce((sum, s) => sum + s.price, 0n);
    const margin = projectMargin({
      signed,
      stock: BigInt(stock?.total ?? "0"),
      budget: Object.fromEntries(byCategory.map((c) => [c.category, c.budget])),
      committed: Object.fromEntries(byCategory.map((c) => [c.category, c.committed])),
    });

    // Cash-flow forecast: what the schedules still expect, against what remains to pay.
    const months = nextMonths(today, FORECAST_MONTHS);
    const current = months[0] ?? monthOf(today);
    const inflow = new Map<MonthKey, Centimes>(months.map((m) => [m, 0n]));
    const outflow = new Map<MonthKey, Centimes>(months.map((m) => [m, 0n]));
    let undatedIn = 0n;
    let laterIn = 0n;
    let laterOut = 0n;
    const put = (map: Map<MonthKey, Centimes>, month: MonthKey, amount: Centimes) => {
      const key = month < current ? current : month;
      if (map.has(key)) map.set(key, (map.get(key) ?? 0n) + amount);
      else if (map === inflow) laterIn += amount;
      else laterOut += amount;
    };
    if (saleIds.length > 0) {
      const lines = await tx
        .select({
          reservationId: installment.reservationId,
          position: installment.position,
          label: installment.label,
          amount: installment.amount,
          dueOn: installment.dueOn,
        })
        .from(installment)
        .where(inArray(installment.reservationId, saleIds));
      const paid = await tx
        .select({
          reservationId: payment.reservationId,
          total: sql<string>`sum(${payment.amount})::text`,
        })
        .from(payment)
        .where(and(inArray(payment.reservationId, saleIds), eq(payment.status, "valid")))
        .groupBy(payment.reservationId);
      for (const id of saleIds) {
        const statement = computeStatement(
          lines.filter((l) => l.reservationId === id),
          BigInt(paid.find((p) => p.reservationId === id)?.total ?? "0"),
          today,
          NO_PENALTIES,
        );
        for (const line of statement.lines) {
          if (line.remaining === 0n) continue;
          if (line.dueOn === null) undatedIn += line.remaining;
          else put(inflow, monthOf(line.dueOn), line.remaining);
        }
      }
    }
    for (const c of contracts) {
      for (const i of c.invoices) {
        if (!i.paidOn) put(outflow, monthOf(i.dueOn ?? i.invoicedOn), i.net);
      }
      if (c.state === "active" || c.state === "provisional") {
        for (const [month, amount] of spreadRemaining(c.remaining, today, c.plannedEndOn)) {
          put(outflow, month, amount);
        }
      }
    }
    let cumulative = 0n;
    const forecast = months.map((month) => {
      const expectedIn = inflow.get(month) ?? 0n;
      const expectedOut = outflow.get(month) ?? 0n;
      cumulative += expectedIn - expectedOut;
      return { month, expectedIn, expectedOut, net: expectedIn - expectedOut, cumulative };
    });

    return {
      project: owner,
      budget,
      contracts,
      byCategory,
      totals: {
        budget: byCategory.reduce((sum, c) => sum + c.budget, 0n),
        committed: byCategory.reduce((sum, c) => sum + c.committed, 0n),
        invoiced: byCategory.reduce((sum, c) => sum + c.invoiced, 0n),
        paid: byCategory.reduce((sum, c) => sum + c.paid, 0n),
        retentionHeld: contracts.reduce((sum, c) => sum + c.retentionHeld, 0n),
        unpaid: contracts.reduce((sum, c) => sum + c.unpaid, 0n),
      },
      revenue: { signed, collected: BigInt(collected?.total ?? "0"), ...margin },
      forecast,
      undatedIn,
      laterIn,
      laterOut,
    };
  });
}

export type ProjectCosts = NonNullable<Awaited<ReturnType<typeof getProjectCosts>>>;

/** One contract with its progress invoices (`cost:read`); null if unknown. */
export async function getWorksContract(ctx: TenantCtx, contractId: string) {
  assertCan(ctx, "cost:read");
  if (!isUuid(contractId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ projectId: worksContract.projectId })
      .from(worksContract)
      .where(and(eq(worksContract.id, contractId), isNull(worksContract.deletedAt)));
    if (!row) return null;
    const contract = (await loadContracts(tx, row.projectId)).find((c) => c.id === contractId);
    if (!contract) return null;
    const [owner] = await tx
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(eq(project.id, row.projectId));
    const accounts = await tx
      .select({ id: treasuryAccount.id, name: treasuryAccount.name })
      .from(treasuryAccount);
    return {
      ...contract,
      projectName: owner?.name ?? "",
      invoices: [...contract.invoices]
        .sort((a, b) => a.position - b.position)
        .map((i) => ({
          ...i,
          accountName: accounts.find((a) => a.id === i.accountId)?.name ?? null,
        })),
      retentionAccountName:
        accounts.find((a) => a.id === contract.retentionAccountId)?.name ?? null,
    };
  });
}

export type WorksContractDetail = NonNullable<Awaited<ReturnType<typeof getWorksContract>>>;

/** Contractors and design offices to choose from (the organization's suppliers). */
export async function listContractorChoices(ctx: TenantCtx) {
  assertCan(ctx, "cost:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: supplier.id, name: supplier.name, activity: supplier.activity })
      .from(supplier)
      .where(isNull(supplier.deletedAt))
      .orderBy(asc(supplier.name)),
  );
}
