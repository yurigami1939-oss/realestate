import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { salaryAdvance, staffAttendance, staffMember, staffPay } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { monthEnd } from "./attendance";
import type { payStaffSchema, savePaySchema } from "./schemas";
import { loadStaff } from "./service";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** Total of an agent's live advances deducted from the pay of `month`. */
async function monthAdvances(tx: Tx, staffId: string, month: CalendarDate) {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${salaryAdvance.amount}), 0)`.mapWith(String) })
    .from(salaryAdvance)
    .where(
      and(
        eq(salaryAdvance.staffId, staffId),
        eq(salaryAdvance.month, month),
        isNull(salaryAdvance.deletedAt),
      ),
    );
  return BigInt(row?.total ?? "0");
}

/** The recorded pay of an agent for a month, if any (locked). */
export async function findPay(tx: Tx, staffId: string, month: CalendarDate) {
  const [row] = await tx
    .select()
    .from(staffPay)
    .where(and(eq(staffPay.staffId, staffId), eq(staffPay.month, month)))
    .for("update");
  return row ?? null;
}

/**
 * Records (or corrects, until paid) an agent's pay for a month: base + bonus − deduction − the
 * month's advances = net to pay, never negative. Audited.
 */
export async function savePay(ctx: TenantCtx, input: In<typeof savePaySchema>) {
  assertCan(ctx, "staff:update");
  return withTenant(ctx, async (tx) => {
    const agent = await loadStaff(tx, input.staffId);
    const end = monthEnd(input.month);
    if (agent.hiredOn > end || (agent.leftOn !== null && agent.leftOn < input.month)) {
      throw invalid("month", "staff.errors.notEmployed");
    }
    const current = await findPay(tx, agent.id, input.month);
    if (current?.paidOn) throw new AppError("CONFLICT", "staff.errors.payPaid");
    const bonus = input.bonus ?? 0n;
    const deduction = input.deduction ?? 0n;
    const advances = await monthAdvances(tx, agent.id, input.month);
    const netAmount = input.baseAmount + bonus - deduction - advances;
    if (netAmount < 0n) throw invalid("deduction", "staff.errors.negativeNet");
    const values = {
      baseAmount: input.baseAmount,
      bonus,
      deduction,
      advances,
      netAmount,
      notes: input.notes,
      recordedBy: ctx.userId,
    };
    let payId = current?.id;
    if (payId) {
      await tx.update(staffPay).set(values).where(eq(staffPay.id, payId));
    } else {
      const [row] = await tx
        .insert(staffPay)
        .values({ ...values, organizationId: ctx.orgId, staffId: agent.id, month: input.month })
        .returning({ id: staffPay.id });
      if (!row) throw new Error("savePay: no row returned");
      payId = row.id;
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "staff_pay.save",
      entityType: "staff_member",
      entityId: agent.id,
      after: { month: input.month, ...values },
    });
    return { payId, netAmount };
  });
}

async function loadPay(tx: Tx, payId: string) {
  const [row] = await tx.select().from(staffPay).where(eq(staffPay.id, payId)).for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** Records the payment of a pay (date, method); then it is read-only. Audited. */
export async function payStaff(ctx: TenantCtx, input: In<typeof payStaffSchema>) {
  assertCan(ctx, "staff:update");
  if (input.paidOn > todayInAlgiers()) throw invalid("paidOn", "charges.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const current = await loadPay(tx, input.payId);
    if (current.paidOn) throw new AppError("CONFLICT", "staff.errors.payPaid");
    if (input.paidOn < current.month) throw invalid("paidOn", "staff.errors.paidBeforeMonth");
    await tx
      .update(staffPay)
      .set({ paidOn: input.paidOn, paymentMethod: input.method })
      .where(eq(staffPay.id, input.payId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "staff_pay.pay",
      entityType: "staff_member",
      entityId: current.staffId,
      after: {
        month: current.month,
        netAmount: current.netAmount,
        paidOn: input.paidOn,
        method: input.method,
      },
    });
  });
}

/** Removes an unpaid pay (its advances can then change). Audited. */
export async function deletePay(ctx: TenantCtx, payId: string) {
  assertCan(ctx, "staff:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadPay(tx, payId);
    if (current.paidOn) throw new AppError("CONFLICT", "staff.errors.payPaid");
    await tx.delete(staffPay).where(eq(staffPay.id, payId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "staff_pay.delete",
      entityType: "staff_member",
      entityId: current.staffId,
      before: { month: current.month, netAmount: current.netAmount },
    });
  });
}

/**
 * Pay sheet of a residence for a month: every agent employed that month with their worked and
 * marked days, the month's advances and the recorded pay (if any).
 */
export async function getPayrollMonth(ctx: TenantCtx, residenceId: string, month: CalendarDate) {
  assertCan(ctx, "staff:read");
  if (!isUuid(residenceId)) return null;
  const end = monthEnd(month);
  return withTenant(ctx, async (tx) => {
    const staff = await tx
      .select({
        id: staffMember.id,
        lastName: staffMember.lastName,
        firstName: staffMember.firstName,
        role: staffMember.role,
        hiredOn: staffMember.hiredOn,
        leftOn: staffMember.leftOn,
        monthlySalary: staffMember.monthlySalary,
      })
      .from(staffMember)
      .where(
        and(
          eq(staffMember.residenceId, residenceId),
          isNull(staffMember.deletedAt),
          lte(staffMember.hiredOn, end),
          or(isNull(staffMember.leftOn), gte(staffMember.leftOn, month)),
        ),
      )
      .orderBy(asc(staffMember.lastName), asc(staffMember.firstName));
    if (staff.length === 0) return { month, rows: [] };
    const ids = staff.map((s) => s.id);
    const marks = await tx
      .select({ staffId: staffAttendance.staffId, n: sql<number>`count(*)::int` })
      .from(staffAttendance)
      .where(
        and(
          inArray(staffAttendance.staffId, ids),
          gte(staffAttendance.day, month),
          lte(staffAttendance.day, end),
        ),
      )
      .groupBy(staffAttendance.staffId);
    const advances = await tx
      .select({
        staffId: salaryAdvance.staffId,
        total: sql<string>`sum(${salaryAdvance.amount})`.mapWith(String),
      })
      .from(salaryAdvance)
      .where(
        and(
          inArray(salaryAdvance.staffId, ids),
          eq(salaryAdvance.month, month),
          isNull(salaryAdvance.deletedAt),
        ),
      )
      .groupBy(salaryAdvance.staffId);
    const pays = await tx
      .select()
      .from(staffPay)
      .where(and(inArray(staffPay.staffId, ids), eq(staffPay.month, month)));
    return {
      month,
      rows: staff.map((agent) => {
        const from = agent.hiredOn > month ? agent.hiredOn : month;
        const to = agent.leftOn !== null && agent.leftOn < end ? agent.leftOn : end;
        let employedDays = 0;
        for (let day = from; day <= to; day = addDays(day, 1)) employedDays += 1;
        const marked = marks.find((m) => m.staffId === agent.id)?.n ?? 0;
        return {
          ...agent,
          workedDays: employedDays - marked,
          markedDays: marked,
          advances: BigInt(advances.find((a) => a.staffId === agent.id)?.total ?? "0"),
          pay: pays.find((p) => p.staffId === agent.id) ?? null,
        };
      }),
    };
  });
}

export type PayrollMonth = NonNullable<Awaited<ReturnType<typeof getPayrollMonth>>>;
export type PayrollRow = PayrollMonth["rows"][number];

/** Pays of an agent, newest month first. */
export async function listStaffPays(ctx: TenantCtx, staffId: string) {
  assertCan(ctx, "staff:read");
  if (!isUuid(staffId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: staffPay.id,
        month: staffPay.month,
        baseAmount: staffPay.baseAmount,
        bonus: staffPay.bonus,
        deduction: staffPay.deduction,
        advances: staffPay.advances,
        netAmount: staffPay.netAmount,
        paidOn: staffPay.paidOn,
      })
      .from(staffPay)
      .where(eq(staffPay.staffId, staffId))
      .orderBy(desc(staffPay.month)),
  );
}
