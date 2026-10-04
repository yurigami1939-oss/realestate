/** Isomorphic: shared by the staff forms and their actions. */
import { z } from "zod";

import { staffRoles } from "@/lib/residences";
import {
  dateText,
  moneyText,
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
