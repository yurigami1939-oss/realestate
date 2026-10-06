/** Isomorphic: agencies and introducers, and their commissions (CLAUDE.md §7 CRM). */
import { z } from "zod";

import { partnerKinds } from "@/lib/partners";
import { counterPaymentMethods } from "@/lib/sales";
import {
  dateText,
  optionalEmailText,
  optionalPhoneText,
  optionalText,
  percentText,
  requiredText,
} from "@/lib/zod";

const partnerFields = {
  kind: z.enum(partnerKinds),
  name: requiredText(120),
  contactName: optionalText(120),
  phone: optionalPhoneText(),
  email: optionalEmailText(),
  nif: optionalText(30),
  rcNumber: optionalText(30),
  /** Percent of the net price, earned at the VSP. */
  commissionRate: percentText(0, 20),
  notes: optionalText(1000),
};
export const createPartnerSchema = z.object(partnerFields);
export const updatePartnerSchema = z.object({ partnerId: z.uuid(), ...partnerFields });

/** A partner's earned commission paid out, from an account. */
export const payPartnerCommissionSchema = z.object({
  commissionId: z.uuid(),
  paidOn: dateText(),
  method: z.enum(counterPaymentMethods),
  /** Paid from (« Payé depuis »); "" = the method's default account. */
  accountId: z.uuid().or(z.literal("")).optional(),
});
