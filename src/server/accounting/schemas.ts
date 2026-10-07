/** Isomorphic: the accounting export's chart (CLAUDE.md §7 Treasury). */
import { z } from "zod";

import { type AccountingKey, accountingKeys } from "@/lib/accounting";

/** An account number of the chart: digits (and letters for auxiliaries), blank = the default. */
const code = z
  .string()
  .trim()
  .max(20, "validation.tooLong")
  .regex(/^[0-9A-Za-z]*$/, "validation.accountCode");

/** The chart's codes by flow nature; blank ones fall back on the SCF defaults. */
export const accountingCodesSchema = z.object({
  codes: z
    .object(
      Object.fromEntries(accountingKeys.map((key) => [key, code.default("")])) as Record<
        AccountingKey,
        ReturnType<typeof code.default>
      >,
    )
    .transform((codes) =>
      Object.fromEntries(Object.entries(codes).filter(([, value]) => value !== "")),
    ),
  /** Each treasury account's own code and journal (blank = by kind: 53 / CA, 512 / BQ…). */
  accounts: z
    .array(
      z.object({
        accountId: z.uuid(),
        code: code.transform((v) => v || null),
        journal: code.transform((v) => v || null),
      }),
    )
    .max(100),
});
