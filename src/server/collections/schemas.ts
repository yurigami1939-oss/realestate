/** Isomorphic: shared by the reminder dialog and its action. */
import { z } from "zod";

import { dateText } from "@/lib/zod";

/** Days given by default to settle after a reminder letter (editable in the dialog). */
export const REMINDER_PAY_WITHIN_DAYS = 8;

export const issueReminderSchema = z.object({
  reservationId: z.uuid(),
  /** Date by which the buyer is asked to settle (today or later). */
  payBy: dateText(),
});

export const OVERDUE_PAGE_SIZE = 50;

export const overdueListParams = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
