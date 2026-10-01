import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Tx } from "@/db/client";
import {
  buyer,
  installment,
  project,
  reminderLetter,
  reservation,
  reservationBuyer,
  unit,
  user,
} from "@/db/schema";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { type Statement, type StatementInstallment, computeStatement } from "@/lib/statement";
import type { TenantCtx } from "@/server/auth/session";
import { loadSalesSettings } from "@/server/organizations/settings";
import { visibleSales } from "@/server/sales/access";
import { buyerNames, paidTotals } from "@/server/sales/sale-queries";

const commercial = alias(user, "commercial");

export type OverdueSale = {
  id: string;
  number: string;
  unitCode: string;
  projectName: string;
  commercialName: string | null;
  buyers: string;
  phone: string | null;
  overdue: bigint;
  penalties: bigint;
  /** Due date of the oldest unpaid installment, and the days since. */
  oldestDueOn: CalendarDate;
  daysLate: number;
  lastReminderAt: Date | null;
  statement: Statement<StatementInstallment>;
};

/**
 * Live sales with overdue installments (derived: due before today and not covered by the
 * valid payments, CLAUDE.md §7), most late first. `ctx` limits them to visible sales; jobs
 * omit it.
 */
export async function loadOverdueSales(
  tx: Tx,
  orgId: string,
  ctx?: TenantCtx,
): Promise<OverdueSale[]> {
  const today = todayInAlgiers();
  const sales = await tx
    .select({
      id: reservation.id,
      number: reservation.number,
      unitCode: unit.code,
      projectName: project.name,
      commercialName: commercial.name,
    })
    .from(reservation)
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .leftJoin(commercial, eq(commercial.id, reservation.commercialUserId))
    .where(
      and(
        inArray(reservation.status, ["reserved", "sold"]),
        ctx ? visibleSales(ctx) : undefined,
        sql`exists (select 1 from installment i
          where i.reservation_id = ${reservation.id} and i.due_on < ${today}::date)`,
      ),
    );
  if (sales.length === 0) return [];
  const ids = sales.map((s) => s.id);

  const installments = await tx
    .select({
      reservationId: installment.reservationId,
      position: installment.position,
      label: installment.label,
      amount: installment.amount,
      dueOn: installment.dueOn,
    })
    .from(installment)
    .where(inArray(installment.reservationId, ids))
    .orderBy(asc(installment.position));
  const paid = await paidTotals(tx, ids);
  const names = await buyerNames(tx, ids);
  const phones = await tx
    .select({ reservationId: reservationBuyer.reservationId, phone: buyer.phone })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(and(inArray(reservationBuyer.reservationId, ids), eq(reservationBuyer.position, 1)));
  const reminders = await tx
    .select({
      reservationId: reminderLetter.reservationId,
      last: sql<Date>`max(${reminderLetter.issuedAt})`.mapWith((v: string) => new Date(v)),
    })
    .from(reminderLetter)
    .where(inArray(reminderLetter.reservationId, ids))
    .groupBy(reminderLetter.reservationId);
  const settings = await loadSalesSettings(tx, orgId);
  const rules = {
    monthlyRateBp: settings.penaltyMonthlyRateBp,
    graceDays: settings.penaltyGraceDays,
    capBp: settings.penaltyCapBp,
  };

  const rows: OverdueSale[] = [];
  for (const sale of sales) {
    const statement = computeStatement(
      installments.filter((i) => i.reservationId === sale.id),
      paid.get(sale.id) ?? 0n,
      today,
      rules,
    );
    const oldest = statement.lines.find((l) => l.state === "overdue");
    if (statement.overdue === 0n || !oldest?.dueOn) continue;
    rows.push({
      ...sale,
      buyers: names.get(sale.id) ?? "—",
      phone: phones.find((p) => p.reservationId === sale.id)?.phone ?? null,
      overdue: statement.overdue,
      penalties: statement.penalties,
      oldestDueOn: oldest.dueOn,
      daysLate: oldest.daysLate,
      lastReminderAt: reminders.find((r) => r.reservationId === sale.id)?.last ?? null,
      statement,
    });
  }
  return rows.sort((a, b) => b.daysLate - a.daysLate || a.number.localeCompare(b.number));
}

/** Reminder letters of a sale, most recent first. */
export async function loadSaleReminders(tx: Tx, reservationId: string) {
  return tx
    .select({
      id: reminderLetter.id,
      issuedAt: reminderLetter.issuedAt,
      overdue: reminderLetter.overdue,
      payBy: reminderLetter.payBy,
      pdfFileId: reminderLetter.pdfFileId,
      issuedByName: user.name,
    })
    .from(reminderLetter)
    .innerJoin(user, eq(user.id, reminderLetter.issuedBy))
    .where(eq(reminderLetter.reservationId, reservationId))
    .orderBy(desc(reminderLetter.issuedAt));
}
