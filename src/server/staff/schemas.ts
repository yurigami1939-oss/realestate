/** Isomorphic: shared by the staff forms and their actions. */
import { z } from "zod";

import { attendanceStatuses, chargePaymentMethods, staffRoles } from "@/lib/residences";
import {
  dateText,
  moneyText,
  optionalMoneyText,
  optionalNinText,
  optionalPhoneText,
  optionalText,
  requiredText,
} from "@/lib/zod";

/** "" → null for optional ids coming from selects. */
const optionalId = () => z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v));

/** `<input type="month">` value "YYYY-MM" → first day of the month. */
export const monthText = () =>
  z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "validation.date")
    .transform((v) => `${v}-01`);

const staffFields = {
  role: z.enum(staffRoles),
  lastName: requiredText(80),
  firstName: requiredText(80),
  lastNameAr: optionalText(80),
  firstNameAr: optionalText(80),
  phone: optionalPhoneText(),
  nin: optionalNinText(),
  hiredOn: dateText(),
  /** Monthly net salary. */
  monthlySalary: moneyText(),
  /** Charge category its pay is booked to. */
  categoryId: optionalId(),
  notes: optionalText(1000),
};

export const createStaffSchema = z.object({ residenceId: z.uuid(), ...staffFields });
export const updateStaffSchema = z.object({ staffId: z.uuid(), ...staffFields });

/** End of employment: last day worked. */
export const endStaffSchema = z.object({ staffId: z.uuid(), leftOn: dateText() });

/** Salary advance, deducted from the pay of `month`. */
export const recordAdvanceSchema = z.object({
  staffId: z.uuid(),
  paidOn: dateText(),
  month: monthText(),
  amount: moneyText().refine((v) => v > 0n, "validation.amount"),
  notes: optionalText(500),
});
export const advanceIdSchema = z.object({ advanceId: z.uuid() });

/** Marked days of a residence's agents for a month (unmarked days are worked), saved whole. */
export const saveAttendanceSchema = z.object({
  residenceId: z.uuid(),
  month: monthText(),
  marks: z
    .array(z.object({ staffId: z.uuid(), day: dateText(), status: z.enum(attendanceStatuses) }))
    .max(5000),
});

/** Monthly pay of an agent, entered as net amounts; the month's advances are deducted. */
export const savePaySchema = z.object({
  staffId: z.uuid(),
  month: monthText(),
  baseAmount: moneyText(),
  bonus: optionalMoneyText(),
  deduction: optionalMoneyText(),
  notes: optionalText(500),
});

/** Payment of a recorded pay. */
export const payStaffSchema = z.object({
  payId: z.uuid(),
  paidOn: dateText(),
  method: z.enum(chargePaymentMethods),
});
export const payIdSchema = z.object({ payId: z.uuid() });
