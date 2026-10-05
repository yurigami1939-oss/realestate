/** Isomorphic: shared by the online payment forms (portal, settings) and their actions. */
import { z } from "zod";

import {
  gatewayEnvironments,
  MIN_ONLINE_PAYMENT,
  onlinePaymentPurposes,
  onlinePaymentStatuses,
} from "@/lib/online-payments";
import { moneyText, optionalText, requiredText } from "@/lib/zod";

/** The gérant's SATIM merchant account; an empty password keeps the saved one. */
export const gatewaySettingsSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(gatewayEnvironments),
  username: requiredText(60),
  password: z.string().trim().max(120),
  terminalId: requiredText(40),
  salesEnabled: z.boolean(),
  chargesEnabled: z.boolean(),
});

/**
 * A portal account pays online: a sale of its own (`targetId` = the sale) or the charges of a
 * unit it co-owns (`targetId` = the unit), at least 50 DA, after accepting the conditions.
 */
export const startOnlinePaymentSchema = z.object({
  purpose: z.enum(onlinePaymentPurposes),
  targetId: z.uuid(),
  amount: moneyText().refine((v) => v >= MIN_ONLINE_PAYMENT, "onlinePayments.errors.minimum"),
  acceptTerms: z.boolean().refine((v) => v, "onlinePayments.errors.terms"),
});

export const onlinePaymentIdSchema = z.object({ onlinePaymentId: z.uuid() });

/** Refund of a paid online payment (its payment and receipt are cancelled with the reason). */
export const refundOnlinePaymentSchema = z.object({
  onlinePaymentId: z.uuid(),
  reason: requiredText(300),
});

/** Filters of the staff list (URL search params). */
export const onlinePaymentListParams = z.object({
  status: z.enum(onlinePaymentStatuses).optional().catch(undefined),
  /** Paid but not recorded: to refund or settle by hand. */
  issues: z.literal("1").optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
  q: optionalText(80).catch(null),
});
export type OnlinePaymentListParams = z.output<typeof onlinePaymentListParams>;
