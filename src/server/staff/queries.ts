import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { chargeCategory, salaryAdvance, staffMember, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";

/** Agents of a residence: those still employed first, then by name. */
export async function listStaff(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "staff:read");
  if (!isUuid(residenceId)) return [];
  const today = todayInAlgiers();
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: staffMember.id,
        role: staffMember.role,
        lastName: staffMember.lastName,
        firstName: staffMember.firstName,
        lastNameAr: staffMember.lastNameAr,
        firstNameAr: staffMember.firstNameAr,
        phone: staffMember.phone,
        nin: staffMember.nin,
        hiredOn: staffMember.hiredOn,
        leftOn: staffMember.leftOn,
        monthlySalary: staffMember.monthlySalary,
        categoryId: staffMember.categoryId,
        categoryName: chargeCategory.name,
        notes: staffMember.notes,
      })
      .from(staffMember)
      .leftJoin(chargeCategory, eq(chargeCategory.id, staffMember.categoryId))
      .where(and(eq(staffMember.residenceId, residenceId), isNull(staffMember.deletedAt)))
      .orderBy(
        sql`${staffMember.leftOn} is not null`,
        asc(staffMember.lastName),
        asc(staffMember.firstName),
      ),
  );
  return rows.map((r) => ({ ...r, employed: r.leftOn === null || r.leftOn >= today }));
}

export type StaffRow = Awaited<ReturnType<typeof listStaff>>[number];

/** An agent of a residence with their salary advances (newest first). */
export async function getStaffMember(ctx: TenantCtx, residenceId: string, staffId: string) {
  assertCan(ctx, "staff:read");
  if (!isUuid(staffId)) return null;
  const agent = (await listStaff(ctx, residenceId)).find((s) => s.id === staffId);
  if (!agent) return null;
  const advances = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: salaryAdvance.id,
        paidOn: salaryAdvance.paidOn,
        month: salaryAdvance.month,
        amount: salaryAdvance.amount,
        notes: salaryAdvance.notes,
        recordedByName: user.name,
      })
      .from(salaryAdvance)
      .innerJoin(user, eq(user.id, salaryAdvance.recordedBy))
      .where(and(eq(salaryAdvance.staffId, staffId), isNull(salaryAdvance.deletedAt)))
      .orderBy(desc(salaryAdvance.paidOn), desc(salaryAdvance.createdAt)),
  );
  return { ...agent, residenceId, advances };
}

export type StaffDetail = NonNullable<Awaited<ReturnType<typeof getStaffMember>>>;
