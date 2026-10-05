/**
 * Online payment by card, CIB or Edahabia, through the SATIM gateway (CLAUDE.md §7 Online
 * payment). Isomorphic: shared by the schema, services and UI.
 */
import type { Centimes } from "./money";

/** SATIM's test platform (test cards, no real debit) or production. */
export const gatewayEnvironments = ["test", "production"] as const;
export type GatewayEnvironment = (typeof gatewayEnvironments)[number];

/** What an online payment settles: a sale's installments, or a co-owned unit's charges. */
export const onlinePaymentPurposes = ["sale", "charges"] as const;
export type OnlinePaymentPurpose = (typeof onlinePaymentPurposes)[number];

/**
 * `created` (written, not yet registered) → `pending` (registered with the gateway, the payer on
 * its page) → `paid` | `failed` (declined, cancelled, refused by the gateway) | `expired` (never
 * paid in time); `paid` → `refunded`. A late confirmation still turns a failed or expired
 * payment into `paid`: money taken is always recorded.
 */
export const onlinePaymentStatuses = [
  "created",
  "pending",
  "paid",
  "failed",
  "expired",
  "refunded",
] as const;
export type OnlinePaymentStatus = (typeof onlinePaymentStatuses)[number];

/** SATIM refuses amounts under 50 DA. */
export const MIN_ONLINE_PAYMENT: Centimes = 5_000n;

/** SATIM's free help line, shown with every online payment. */
export const SATIM_HELP_NUMBER = "3020";

/** The order number sent to the gateway: 10 characters (SATIM's limit), unique per merchant. */
export const ORDER_NUMBER_LENGTH = 10;

/**
 * Amount offered by default: what is due today, else the next installment or call still unpaid
 * (lines in allocation order); never more than the remaining balance.
 */
export function suggestedOnlinePayment(statement: {
  due: Centimes;
  remaining: Centimes;
  lines: readonly { remaining: Centimes }[];
}): Centimes {
  if (statement.due > 0n) return statement.due;
  return statement.lines.find((line) => line.remaining > 0n)?.remaining ?? 0n;
}

/**
 * What the portal offers to pay online on an account: the suggested amount (at least 50 DA) and
 * the remaining balance; null when less than 50 DA remains.
 */
export function onlinePaymentOffer(statement: {
  due: Centimes;
  remaining: Centimes;
  lines: readonly { remaining: Centimes }[];
}): { suggested: Centimes; remaining: Centimes } | null {
  if (statement.remaining < MIN_ONLINE_PAYMENT) return null;
  const suggested = suggestedOnlinePayment(statement);
  return {
    suggested: suggested < MIN_ONLINE_PAYMENT ? MIN_ONLINE_PAYMENT : suggested,
    remaining: statement.remaining,
  };
}
