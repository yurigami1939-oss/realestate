import type { CalendarDate } from "./dates";
import { applyRate, type Centimes, sumCentimes } from "./money";
import type { AddonBasis, AddonCode, BillingPeriod } from "./subscriptions";

/**
 * The operator's invoicing (CLAUDE.console.md §11): invoices `FAC-` issued by hand for a
 * subscription's period, credit notes `AVO-`, payments (never cash). An invoice's state is
 * derived, never stored.
 */
export const invoiceLineKinds = ["subscription", "addon", "setup", "adjustment", "other"] as const;
export type InvoiceLineKind = (typeof invoiceLineKinds)[number];

/** How clients pay the operator: never cash (CLAUDE.console.md §11). */
export const consolePaymentMethods = ["bank_transfer", "cheque", "ccp", "card"] as const;
export type ConsolePaymentMethod = (typeof consolePaymentMethods)[number];

/** The operator's VAT regime: VAT at its rate, or none (a mention on the invoice instead). */
export const vatRegimes = ["vat", "none"] as const;
export type VatRegime = (typeof vatRegimes)[number];

export const invoiceStates = ["due", "overdue", "paid", "credited"] as const;
export type InvoiceState = (typeof invoiceStates)[number];

/** Who sells or buys, as printed on an invoice (snapshotted at issue). */
export type InvoiceParty = {
  legalName: string;
  brand?: string | null;
  legalForm?: string | null;
  address?: string | null;
  wilaya?: string | null;
  phone?: string | null;
  email?: string | null;
  rcNumber?: string | null;
  nif?: string | null;
  nis?: string | null;
  aiNumber?: string | null;
  /** The seller's bank and RIB, printed for the transfer. */
  bank?: string | null;
  rib?: string | null;
  footerFr?: string | null;
  footerAr?: string | null;
  /** The seller's logo in storage, embedded when the PDF is rendered. */
  logoKey?: string | null;
};

/** The add-ons' names as printed on invoices (French, Arabic). */
export const addonLabels: Record<AddonCode, { fr: string; ar: string }> = {
  syndic: { fr: "Syndic", ar: "تسيير العمارات" },
  rentals: { fr: "Locations", ar: "الإيجارات" },
  whatsapp: { fr: "WhatsApp et SMS", ar: "واتساب والرسائل القصيرة" },
  online_payment: { fr: "Paiement en ligne", ar: "الدفع الإلكتروني" },
};

/** Months of a billing period. */
export const periodMonths = (period: BillingPeriod): number => (period === "yearly" ? 12 : 3);

/** A line's amount (HT): quantity × unit price. */
export const lineAmount = (quantity: number, unitPrice: Centimes): Centimes =>
  BigInt(quantity) * unitPrice;

/** HT, VAT (half-up on the total, none without a rate) and TTC of an invoice's lines. */
export function invoiceTotals(
  lines: readonly { amount: Centimes }[],
  vatRateBp: number | null,
): { ht: Centimes; vat: Centimes; ttc: Centimes } {
  const ht = sumCentimes(lines.map((l) => l.amount));
  const vat = vatRateBp === null ? 0n : applyRate(ht, vatRateBp);
  return { ht, vat, ttc: ht + vat };
}

/** What remains to pay on an invoice: TTC − credit notes − valid payments. */
export const invoiceRemaining = (input: {
  totalTtc: Centimes;
  credited: Centimes;
  paid: Centimes;
}): Centimes => input.totalTtc - input.credited - input.paid;

/**
 * An invoice's state (derived): `credited` when credit notes cover it all, `paid` when nothing
 * remains, `overdue` when due before today (Algiers) with something unpaid, else `due`.
 */
export function invoiceState(
  input: { totalTtc: Centimes; credited: Centimes; paid: Centimes; dueOn: CalendarDate },
  today: CalendarDate,
): InvoiceState {
  if (invoiceRemaining(input) <= 0n) {
    return input.credited >= input.totalTtc ? "credited" : "paid";
  }
  return input.dueOn < today ? "overdue" : "due";
}

/** Half-up division of centimes by a count of months. */
const perMonth = (amount: Centimes, months: number): Centimes =>
  (amount * 2n + BigInt(months)) / (2n * BigInt(months));

/**
 * A subscription's monthly equivalent (MRR, CLAUDE.console.md §10): its price after discount and
 * its flat add-ons divided by the period's months, plus the syndic per managed lot and month.
 */
export function monthlyEquivalent(
  subscription: { price: Centimes; discountBp: number; billingPeriod: BillingPeriod },
  addons: readonly { basis: AddonBasis; price: Centimes }[],
  managedLots: number,
): Centimes {
  const months = periodMonths(subscription.billingPeriod);
  const net = subscription.price - applyRate(subscription.price, subscription.discountBp);
  let total = perMonth(net, months);
  for (const addon of addons) {
    total +=
      addon.basis === "per_managed_lot"
        ? addon.price * BigInt(managedLots)
        : perMonth(addon.price, months);
  }
  return total;
}

/**
 * The syndic's true-up of a period (CLAUDE.console.md §11): the lots managed on average over its
 * monthly snapshots beyond the lots billed, in lot-months; nothing when not positive.
 */
export function syndicTrueUp(input: {
  averageLots: number;
  billedLots: number;
  months: number;
}): number {
  return Math.max(0, input.averageLots - input.billedLots) * input.months;
}

/** The average of monthly figures, half-up to a whole lot (0 without figures). */
export function averageLots(monthly: readonly number[]): number {
  if (monthly.length === 0) return 0;
  const sum = monthly.reduce((a, b) => a + b, 0);
  return Math.floor((2 * sum + monthly.length) / (2 * monthly.length));
}
