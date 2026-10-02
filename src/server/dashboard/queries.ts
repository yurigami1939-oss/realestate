import "server-only";

import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  buyer,
  commission,
  constructionMilestone,
  followUp,
  installment,
  lead,
  payment,
  project,
  reservation,
  reservationBuyer,
  unit,
  unitOption,
  withdrawal,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, addMonths, type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { computeStatement } from "@/lib/statement";
import type { TenantCtx } from "@/server/auth/session";
import { seesAllLeads, visibleLeads } from "@/server/crm/access";
import { visibleSales } from "@/server/sales/access";
import { paidTotals } from "@/server/sales/sale-queries";

const money = (expr: ReturnType<typeof sql>) =>
  sql<string>`coalesce(${expr}, 0)::text`.mapWith((v: string) => BigInt(v));

type Period = { from: CalendarDate; to: CalendarDate };

/** Calendar month of `day` and the one before it (Algiers days, `to` exclusive). */
function months(day: CalendarDate): { current: Period; previous: Period; year: Period } {
  const first = `${day.slice(0, 7)}-01`;
  return {
    current: { from: first, to: addMonths(first, 1) },
    previous: { from: addMonths(first, -1), to: first },
    year: { from: `${day.slice(0, 4)}-01-01`, to: `${Number(day.slice(0, 4)) + 1}-01-01` },
  };
}

/** Units by commercial state, overall and per project. */
async function stock(tx: Tx) {
  const rows = await tx
    .select({
      projectId: project.id,
      name: project.name,
      units: sql<number>`count(${unit.id})::int`,
      available: sql<number>`count(${unit.id}) filter (where ${unit.status} = 'available')::int`,
      engaged: sql<number>`count(${unit.id}) filter (where ${unit.status} in ('optioned', 'reserved'))::int`,
      sold: sql<number>`count(${unit.id}) filter (where ${unit.status} in ('sold', 'delivered'))::int`,
      unavailable: sql<number>`count(${unit.id}) filter (where ${unit.status} in ('blocked', 'rented'))::int`,
      stockValue: money(
        sql`sum(${unit.listPrice}) filter (where ${unit.status} in ('available', 'optioned'))`,
      ),
    })
    .from(project)
    .leftJoin(unit, and(eq(unit.projectId, project.id), isNull(unit.deletedAt)))
    .where(isNull(project.deletedAt))
    .groupBy(project.id)
    .orderBy(asc(project.name));
  const sum = (key: "units" | "available" | "engaged" | "sold" | "unavailable") =>
    rows.reduce((total, r) => total + r[key], 0);
  return {
    projects: rows,
    totals: {
      units: sum("units"),
      available: sum("available"),
      engaged: sum("engaged"),
      sold: sum("sold"),
      unavailable: sum("unavailable"),
    },
    stockValue: rows.reduce((total, r) => total + r.stockValue, 0n),
  };
}

/** Reservations and VSP signed in a period, on visible sales. */
async function signed(tx: Tx, ctx: TenantCtx, period: Period) {
  const [reservations] = await tx
    .select({ n: sql<number>`count(*)::int`, value: money(sql`sum(${reservation.price})`) })
    .from(reservation)
    .where(
      and(
        visibleSales(ctx),
        ne(reservation.status, "withdrawn"),
        gte(reservation.reservedOn, period.from),
        lt(reservation.reservedOn, period.to),
      ),
    );
  const [sales] = await tx
    .select({ n: sql<number>`count(*)::int`, value: money(sql`sum(${reservation.price})`) })
    .from(reservation)
    .where(
      and(
        visibleSales(ctx),
        eq(reservation.status, "sold"),
        gte(reservation.saleSignedOn, period.from),
        lt(reservation.saleSignedOn, period.to),
      ),
    );
  return {
    reservations: { count: reservations?.n ?? 0, value: reservations?.value ?? 0n },
    sales: { count: sales?.n ?? 0, value: sales?.value ?? 0n },
  };
}

/** Valid payments received in a period, on visible sales. */
async function collected(tx: Tx, ctx: TenantCtx, period: Period) {
  const [row] = await tx
    .select({ value: money(sql`sum(${payment.amount})`) })
    .from(payment)
    .innerJoin(reservation, eq(reservation.id, payment.reservationId))
    .where(
      and(
        visibleSales(ctx),
        eq(payment.status, "valid"),
        gte(payment.paidOn, period.from),
        lt(payment.paidOn, period.to),
      ),
    );
  return row?.value ?? 0n;
}

/**
 * What live visible sales still owe (derived statements, CLAUDE.md §7): remaining, due now,
 * overdue (and on how many sales), and what falls due in the next 30 days.
 */
async function receivables(tx: Tx, ctx: TenantCtx, today: CalendarDate) {
  const sales = await tx
    .select({ id: reservation.id })
    .from(reservation)
    .where(and(visibleSales(ctx), inArray(reservation.status, ["reserved", "sold"])));
  const ids = sales.map((s) => s.id);
  const totals = { remaining: 0n, due: 0n, overdue: 0n, overdueSales: 0, next30Days: 0n };
  if (ids.length === 0) return totals;
  const installments = await tx
    .select({
      reservationId: installment.reservationId,
      position: installment.position,
      label: installment.label,
      amount: installment.amount,
      dueOn: installment.dueOn,
    })
    .from(installment)
    .where(inArray(installment.reservationId, ids));
  const paid = await paidTotals(tx, ids);
  const horizon = addDays(today, 30);
  const noPenalty = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };
  for (const id of ids) {
    const statement = computeStatement(
      installments.filter((i) => i.reservationId === id),
      paid.get(id) ?? 0n,
      today,
      noPenalty,
    );
    totals.remaining += statement.remaining;
    totals.due += statement.due;
    totals.overdue += statement.overdue;
    if (statement.overdue > 0n) totals.overdueSales += 1;
    for (const line of statement.lines) {
      if (line.dueOn && line.dueOn > today && line.dueOn <= horizon) {
        totals.next30Days += line.remaining;
      }
    }
  }
  return totals;
}

/** Lead counts by stage (visible leads), new leads of the month and overdue follow-ups. */
async function pipeline(tx: Tx, ctx: TenantCtx, month: Period) {
  const stages = await tx
    .select({ stage: lead.stage, n: sql<number>`count(*)::int` })
    .from(lead)
    .where(and(isNull(lead.deletedAt), visibleLeads(ctx)))
    .groupBy(lead.stage);
  const [created] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(lead)
    .where(
      and(
        isNull(lead.deletedAt),
        visibleLeads(ctx),
        sql`(${lead.createdAt} at time zone 'Africa/Algiers')::date >= ${month.from}::date`,
        sql`(${lead.createdAt} at time zone 'Africa/Algiers')::date < ${month.to}::date`,
      ),
    );
  const [lateFollowUps] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(followUp)
    .innerJoin(lead, eq(lead.id, followUp.leadId))
    .where(
      and(
        isNull(followUp.doneAt),
        isNull(lead.deletedAt),
        sql`${followUp.dueAt} < now()`,
        seesAllLeads(ctx) ? undefined : eq(followUp.assignedTo, ctx.userId),
      ),
    );
  return {
    stages: Object.fromEntries(stages.map((s) => [s.stage, s.n])) as Record<string, number>,
    newLeads: created?.n ?? 0,
    lateFollowUps: lateFollowUps?.n ?? 0,
  };
}

/** What waits for the member, by role: approvals, cheques, commissions, options, milestones. */
async function todo(tx: Tx, ctx: TenantCtx, today: CalendarDate) {
  const withdrawals = can(ctx.roles, "sale:approve")
    ? await tx
        .select({
          reservationId: withdrawal.reservationId,
          number: reservation.number,
          refund: withdrawal.refund,
        })
        .from(withdrawal)
        .innerJoin(reservation, eq(reservation.id, withdrawal.reservationId))
        .where(eq(withdrawal.status, "proposed"))
        .orderBy(asc(withdrawal.proposedAt))
    : null;
  const [cheques] = can(ctx.roles, "payment:create")
    ? await tx
        .select({ n: sql<number>`count(*)::int`, value: money(sql`sum(${payment.amount})`) })
        .from(payment)
        .where(
          and(
            eq(payment.method, "cheque"),
            eq(payment.status, "valid"),
            isNull(payment.chequeClearedOn),
          ),
        )
    : [null];
  const [commissions] = can(ctx.roles, "commission:update")
    ? await tx
        .select({ n: sql<number>`count(*)::int`, value: money(sql`sum(${commission.amount})`) })
        .from(commission)
        .where(eq(commission.status, "earned"))
    : [null];
  const options = can(ctx.roles, "sale:create")
    ? await tx
        .select({
          unitId: unit.id,
          projectId: unit.projectId,
          unitCode: unit.code,
          leadId: lead.id,
          leadName: lead.fullName,
          expiresAt: unitOption.expiresAt,
        })
        .from(unitOption)
        .innerJoin(unit, eq(unit.id, unitOption.unitId))
        .innerJoin(lead, eq(lead.id, unitOption.leadId))
        .where(
          and(
            eq(unitOption.status, "active"),
            visibleLeads(ctx),
            sql`${unitOption.expiresAt} < now() + interval '24 hours'`,
          ),
        )
        .orderBy(asc(unitOption.expiresAt))
    : null;
  const milestones = can(ctx.roles, "milestone:validate")
    ? await tx
        .select({
          id: constructionMilestone.id,
          projectId: constructionMilestone.projectId,
          projectName: project.name,
          name: constructionMilestone.name,
          plannedOn: constructionMilestone.plannedOn,
        })
        .from(constructionMilestone)
        .innerJoin(project, eq(project.id, constructionMilestone.projectId))
        .where(
          and(
            isNull(constructionMilestone.deletedAt),
            isNull(constructionMilestone.validatedOn),
            lte(constructionMilestone.plannedOn, today),
          ),
        )
        .orderBy(asc(constructionMilestone.plannedOn))
    : null;
  return {
    withdrawals,
    cheques: cheques ? { count: cheques.n, value: cheques.value } : null,
    commissions: commissions ? { count: commissions.n, value: commissions.value } : null,
    options,
    milestones,
  };
}

/** Main buyer name of each sale (approvals list). */
async function mainBuyers(tx: Tx, reservationIds: string[]) {
  if (reservationIds.length === 0) return new Map<string, string>();
  const rows = await tx
    .select({
      reservationId: reservationBuyer.reservationId,
      lastName: buyer.lastName,
      firstName: buyer.firstName,
    })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(
      and(
        inArray(reservationBuyer.reservationId, reservationIds),
        eq(reservationBuyer.position, 1),
      ),
    );
  return new Map(rows.map((r) => [r.reservationId, `${r.lastName} ${r.firstName}`]));
}

/**
 * Dashboard of the member (CLAUDE.md §11): each section is computed only when their roles
 * may see it (null otherwise); sales figures follow the sale visibility (a commercial sees
 * their own sales and leads).
 */
export async function getDashboard(ctx: TenantCtx) {
  const today = todayInAlgiers();
  const periods = months(today);
  return withTenant(ctx, async (tx) => {
    const salesVisible = can(ctx.roles, "sale:read");
    const sales = salesVisible
      ? {
          month: await signed(tx, ctx, periods.current),
          previousMonth: await signed(tx, ctx, periods.previous),
          year: await signed(tx, ctx, periods.year),
        }
      : null;
    const collections = salesVisible
      ? {
          month: await collected(tx, ctx, periods.current),
          previousMonth: await collected(tx, ctx, periods.previous),
          ...(await receivables(tx, ctx, today)),
        }
      : null;
    const tasks = await todo(tx, ctx, today);
    const buyers = await mainBuyers(tx, tasks.withdrawals?.map((w) => w.reservationId) ?? []);
    return {
      today,
      month: periods.current.from,
      stock: can(ctx.roles, "inventory:read") ? await stock(tx) : null,
      sales,
      collections,
      pipeline: can(ctx.roles, "lead:read") ? await pipeline(tx, ctx, periods.current) : null,
      todo: {
        ...tasks,
        withdrawals:
          tasks.withdrawals?.map((w) => ({ ...w, buyer: buyers.get(w.reservationId) ?? "—" })) ??
          null,
      },
    };
  });
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
