import { type Centimes, formatDecimal, type MoneyLocale } from "./money";

/**
 * Payments from abroad (CLAUDE.md §7 Payments): the currencies a transfer from the diaspora
 * comes in (ISO 4217, two decimals each), the amount in that currency kept beside the dinars
 * the bank credited, and the rate that makes.
 */
export const foreignCurrencies = ["EUR", "USD", "GBP", "CAD", "CHF", "AED", "SAR", "QAR"] as const;
export type ForeignCurrency = (typeof foreignCurrencies)[number];

export const isForeignCurrency = (value: unknown): value is ForeignCurrency =>
  typeof value === "string" && (foreignCurrencies as readonly string[]).includes(value);

/** « 10 000,00 EUR »: hundredths of the currency, written like the dinars, its ISO code after. */
export const formatForeign = (
  minor: bigint,
  currency: ForeignCurrency,
  locale: MoneyLocale = "fr",
): string => `${formatDecimal(minor, locale)}\u00a0${currency}`;

/** Dinars credited for one unit of the currency, four decimals, half-up (« 147,2500 »). */
export function exchangeRate(amount: Centimes, minor: bigint): string {
  if (minor <= 0n) throw new RangeError("exchangeRate expects a positive foreign amount");
  const scaled = (amount * 10_000n + minor / 2n) / minor;
  return `${scaled / 10_000n},${(scaled % 10_000n).toString().padStart(4, "0")}`;
}

/** « 1 EUR = 147,2500 DA » (fr) · « 1 EUR = 147,2500 د.ج » (ar). */
export const rateText = (
  amount: Centimes,
  minor: bigint,
  currency: ForeignCurrency,
  locale: MoneyLocale = "fr",
): string => `1 ${currency} = ${exchangeRate(amount, minor)} ${locale === "ar" ? "د.ج" : "DA"}`;
