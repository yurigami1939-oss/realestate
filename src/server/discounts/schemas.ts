/** Isomorphic: discount request forms and their actions (CLAUDE.md §7). */
import { z } from "zod";

import { discountRequestStates } from "@/lib/discounts";
import { moneyText, optionalMoneyText, optionalText, requiredText } from "@/lib/zod";

/** A commercial asks for a discount on a unit for one of their leads. */
export const requestDiscountSchema = z.object({
  leadId: z.uuid(),
  unitId: z.uuid(),
  amount: moneyText(),
  reason: requiredText(500),
});

/** A manager approves (for the amount asked or less) or rejects (with a note). */
export const decideDiscountSchema = z.object({
  requestId: z.uuid(),
  approve: z.boolean(),
  /** Approved amount; "" = the amount asked. */
  amount: optionalMoneyText(),
  note: optionalText(500),
});

export const discountRequestIdSchema = z.object({ requestId: z.uuid() });

/** Managers' list: pending requests by default. */
export const discountListParams = z.object({
  state: z.enum([...discountRequestStates, "all"]).catch("pending"),
  page: z.coerce.number().int().min(1).catch(1),
});
export type DiscountListParams = z.output<typeof discountListParams>;
