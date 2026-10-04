import "server-only";

import { and, asc, between, eq, inArray, isNull, lte, or, gte } from "drizzle-orm";
import type { z } from "zod";

import { staffAttendance, staffMember } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, addMonths, type CalendarDate } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";

import type { saveAttendanceSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Last day of the month that starts on `month` (YYYY-MM-01). */
export const monthEnd = (month: CalendarDate): CalendarDate => addDays(addMonths(month, 1), -1);

/** Every day of the month that starts on `month`. */
export function monthDays(month: CalendarDate): CalendarDate[] {
  const end = monthEnd(month);
  const days: CalendarDate[] = [];
  for (let day = month; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Agents of a residence employed at some point during the month. */
async function monthStaff(ctx: TenantCtx, residenceId: string, month: CalendarDate) {
  const end = monthEnd(month);
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: staffMember.id,
        lastName: staffMember.lastName,
        firstName: staffMember.firstName,
        role: staffMember.role,
        hiredOn: staffMember.hiredOn,
        leftOn: staffMember.leftOn,
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
      .orderBy(asc(staffMember.lastName), asc(staffMember.firstName)),
  );
}

/**
 * Saves the month's attendance of a residence as a whole: the marks replace the previous ones
 * of its agents for that month. A mark outside the agent's employment is refused.
 */
export async function saveAttendance(ctx: TenantCtx, input: In<typeof saveAttendanceSchema>) {
  assertCan(ctx, "staff:update");
  const end = monthEnd(input.month);
  const staff = await monthStaff(ctx, input.residenceId, input.month);
  const marks = new Map<string, (typeof input.marks)[number]>();
  for (const mark of input.marks) {
    const agent = staff.find((s) => s.id === mark.staffId);
    if (!agent || mark.day < input.month || mark.day > end) {
      throw new AppError("VALIDATION", "staff.errors.attendanceOutOfMonth");
    }
    if (mark.day < agent.hiredOn || (agent.leftOn && mark.day > agent.leftOn)) {
      throw new AppError("VALIDATION", "staff.errors.notEmployed");
    }
    marks.set(`${mark.staffId}:${mark.day}`, mark);
  }
  return withTenant(ctx, async (tx) => {
    await loadResidence(tx, input.residenceId, { forUpdate: true });
    if (staff.length > 0) {
      await tx.delete(staffAttendance).where(
        and(
          inArray(
            staffAttendance.staffId,
            staff.map((s) => s.id),
          ),
          between(staffAttendance.day, input.month, end),
        ),
      );
    }
    if (marks.size > 0) {
      await tx
        .insert(staffAttendance)
        .values([...marks.values()].map((m) => ({ ...m, organizationId: ctx.orgId })));
    }
    return { marks: marks.size };
  });
}

/** The month's attendance grid of a residence: its agents, the days and the marks. */
export async function getAttendanceMonth(ctx: TenantCtx, residenceId: string, month: CalendarDate) {
  assertCan(ctx, "staff:read");
  if (!isUuid(residenceId)) return null;
  const staff = await monthStaff(ctx, residenceId, month);
  const marks =
    staff.length === 0
      ? []
      : await withTenant(ctx, (tx) =>
          tx
            .select({
              staffId: staffAttendance.staffId,
              day: staffAttendance.day,
              status: staffAttendance.status,
            })
            .from(staffAttendance)
            .where(
              and(
                inArray(
                  staffAttendance.staffId,
                  staff.map((s) => s.id),
                ),
                between(staffAttendance.day, month, monthEnd(month)),
              ),
            ),
        );
  return { month, days: monthDays(month), staff, marks };
}

export type AttendanceMonth = NonNullable<Awaited<ReturnType<typeof getAttendanceMonth>>>;
