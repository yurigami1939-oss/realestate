/** Isomorphic: shared by the reminder dialog and its action. */
import { z } from "zod";

import { reminderKinds } from "@/lib/sales";
import { dateText } from "@/lib/zod";

/** Days given by default to settle after a reminder letter (editable in the dialog). */
export const REMINDER_PAY_WITHIN_DAYS = 8;

export const issueReminderSchema = z.object({
  reservationId: z.uuid(),
  /** Date by which the buyer is asked to settle (today or later). */
  payBy: dateText(),
  /** A reminder letter (default) or a formal notice (mise en demeure, managers). */
  kind: z
    .enum(reminderKinds)
    .optional()
    .transform((v) => v ?? "reminder"),
});

export const OVERDUE_PAGE_SIZE = 50;

export const overdueListParams = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
