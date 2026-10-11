/** Isomorphic: shared by the payment forms and actions. */
import { z } from "zod";

import { foreignCurrencies } from "@/lib/currencies";
import { counterPaymentMethods, financingSources } from "@/lib/sales";
import { dateText, moneyText, optionalMoneyText, optionalText, requiredText } from "@/lib/zod";

export const recordPaymentSchema = z
  .object({
    reservationId: z.uuid(),
    amount: moneyText().refine((v) => v > 0n, "validation.amount"),
    method: z.enum(counterPaymentMethods),
    /** Day the money or cheque was received (not in the future). */
    paidOn: dateText(),
    /** Cheque number, transfer reference… */
    reference: optionalText(60),
    bank: optionalText(80),
    payerName: requiredText(160),
    notes: optionalText(500),
    /** The cash desk or account it lands on; empty = the method's default account. */
    accountId: z.uuid().or(z.literal("")).optional(),
    /** Where the money comes from (financing plan); empty = derived from the method. */
    financingSource: z
      .enum(financingSources)
      .or(z.literal(""))
      .optional()
      .transform((v) => v || null),
    /** A transfer from abroad: its currency and amount (`amount` = the dinars credited). */
    currency: z
      .enum(foreignCurrencies)
      .or(z.literal(""))
      .optional()
      .transform((v) => v || null),
    currencyAmount: optionalMoneyText(),
  })
  .refine((v) => v.method !== "cheque" || (v.reference !== null && v.bank !== null), {
    path: ["reference"],
    message: "payments.errors.chequeDetails",
  })
  .refine((v) => v.currency === null || v.method === "bank_transfer", {
    path: ["currency"],
    message: "payments.errors.currencyTransfer",
  })
  .refine(
    (v) =>
      v.currency === null
        ? v.currencyAmount === null
        : v.currencyAmount !== null && v.currencyAmount > 0n,
    { path: ["currencyAmount"], message: "payments.errors.currencyAmount" },
  );

export const cancelPaymentSchema = z.object({
  paymentId: z.uuid(),
  reason: requiredText(300),
});

export const clearChequeSchema = z.object({
  paymentId: z.uuid(),
  clearedOn: dateText(),
});
