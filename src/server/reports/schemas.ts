/** Isomorphic: the management reports' filters (URL search params). */
import { z } from "zod";

import { leadSources } from "@/lib/crm";
import { moneyText, optionalText } from "@/lib/zod";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

/** A period (this year by default) and optionally one project. */
export const reportParams = z.object({
  from: day,
  to: day,
  project: z.uuid().optional().catch(undefined),
});
export type ReportParams = z.output<typeof reportParams>;

/** The marketing spend of a month on a lead source; 0 removes it. */
export const saveMarketingSpendSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "validation.date"),
  source: z.enum(leadSources),
  amount: moneyText(),
  notes: optionalText(300),
});
