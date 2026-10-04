import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { attendanceStatuses, staffRoles } from "../../lib/residences";

import { createdAt, id, money, organizationId, softDelete, timestamps, userRef } from "./_columns";
import { chargeCategory } from "./charges";
import { residence } from "./residences";

export const staffRole = pgEnum("staff_role", staffRoles);
export const attendanceStatus = pgEnum("attendance_status", attendanceStatuses);

/**
 * Agent of a residence (security, cleaning…) employed by the company. Pay is entered as net
 * amounts (no IRG/CNAS computation, CLAUDE.md §12); its cost is booked to a charge category.
 */
export const staffMember = pgTable(
  "staff_member",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    role: staffRole().notNull(),
    lastName: text().notNull(),
    firstName: text().notNull(),
    lastNameAr: text(),
    firstNameAr: text(),
    phone: text(),
    nin: text(),
    hiredOn: date({ mode: "string" }).notNull(),
    /** Last day worked; null while employed. */
    leftOn: date({ mode: "string" }),
    /** Monthly net salary. */
    monthlySalary: money().notNull(),
    /** Charge category its pay is booked to (budget vs actual). */
    categoryId: uuid(),
    notes: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("staff_member_residence_key").on(t.organizationId, t.residenceId, t.id),
    foreignKey({
      name: "staff_member_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "staff_member_category_fk",
      columns: [t.organizationId, t.residenceId, t.categoryId],
      foreignColumns: [
        chargeCategory.organizationId,
        chargeCategory.residenceId,
        chargeCategory.id,
      ],
    }),
    index().on(t.organizationId, t.residenceId),
    check("staff_member_period", sql`${t.leftOn} is null or ${t.leftOn} >= ${t.hiredOn}`),
    check("staff_member_salary", sql`${t.monthlySalary} >= 0`),
  ],
);

/**
 * Avance sur salaire paid to an agent, deducted from the pay of `month` (first day of the
 * month). Removed only while that month's pay is not recorded.
 */
export const salaryAdvance = pgTable(
  "salary_advance",
  {
    id: id(),
    organizationId: organizationId(),
    staffId: uuid().notNull(),
    paidOn: date({ mode: "string" }).notNull(),
    month: date({ mode: "string" }).notNull(),
    amount: money().notNull(),
    notes: text(),
    recordedBy: userRef().notNull(),
    createdAt: createdAt(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "salary_advance_staff_fk",
      columns: [t.organizationId, t.staffId],
      foreignColumns: [staffMember.organizationId, staffMember.id],
    }),
    index().on(t.organizationId, t.staffId, t.month),
    check("salary_advance_amount", sql`${t.amount} > 0`),
    check("salary_advance_month", sql`extract(day from ${t.month}) = 1`),
  ],
);

/**
 * Pointage: the marked days of an agent (absence, leave, sick leave, day off); unmarked days
 * are worked. Saved month by month for a residence.
 */
export const staffAttendance = pgTable(
  "staff_attendance",
  {
    organizationId: organizationId(),
    staffId: uuid().notNull(),
    day: date({ mode: "string" }).notNull(),
    status: attendanceStatus().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.day] }),
    foreignKey({
      name: "staff_attendance_staff_fk",
      columns: [t.organizationId, t.staffId],
      foreignColumns: [staffMember.organizationId, staffMember.id],
    }),
    index().on(t.organizationId, t.day),
  ],
);
