/** Isomorphic: shared by the quotation form (simulator) and its actions. */
import { z } from "zod";

import { optionalMoneyText, optionalText, requiredText } from "@/lib/zod";

export const issueQuotationSchema = z.object({
  leadId: z.uuid(),
  unitId: z.uuid(),
  paymentPlanId: z.uuid(),
  /** Only managers may discount (CLAUDE.md §12); "" = no discount. */
  discount: optionalMoneyText().transform((v) => v ?? 0n),
  notes: optionalText(1000),
});

export const cancelQuotationSchema = z.object({
  quotationId: z.uuid(),
  reason: requiredText(300),
});

export const quotationIdSchema = z.object({ quotationId: z.uuid() });
