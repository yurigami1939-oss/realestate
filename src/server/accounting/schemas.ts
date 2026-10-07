/** Isomorphic: the accounting export's chart (CLAUDE.md §7 Treasury). */
import { z } from "zod";

import { type AccountingKey, accountingKeys, revenueEvents } from "@/lib/accounting";
import { optionalPercentText } from "@/lib/zod";

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
  /** When sales are booked and the tax rates, as set with the accountant (absent = unchanged). */
  tax: z
    .object({
      revenueEvent: z.enum(revenueEvents),
      vatSales: optionalPercentText(0, 30),
      vatRentCommercial: optionalPercentText(0, 30),
      vatRentResidential: optionalPercentText(0, 30),
      stampDuty: optionalPercentText(0, 10),
    })
    .transform((t) => ({
      revenueEvent: t.revenueEvent,
      vatSalesBp: t.vatSales ?? 0,
      vatRentCommercialBp: t.vatRentCommercial ?? 0,
      vatRentResidentialBp: t.vatRentResidential ?? 0,
      stampDutyBp: t.stampDuty ?? 0,
    }))
    .optional(),
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
