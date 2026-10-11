/** Isomorphic: individuals' rights under Loi 18-07 (CLAUDE.md §7 Personal data). */
import { z } from "zod";

import { MAX_RETENTION_MONTHS } from "@/lib/privacy";
import { optionalIntText, requiredText } from "@/lib/zod";

/** A prospect erased at their request (or past its keeping period), with the reason. */
export const anonymizeLeadSchema = z.object({ leadId: z.uuid(), reason: requiredText(300) });

/** The retention periods applied automatically, in months (0 or blank = off). */
export const privacySettingsSchema = z.object({
  leadRetentionMonths: optionalIntText(0, MAX_RETENTION_MONTHS).transform((v) => v ?? 0),
  messageRetentionMonths: optionalIntText(0, MAX_RETENTION_MONTHS).transform((v) => v ?? 0),
});
