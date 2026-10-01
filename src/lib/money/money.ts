/**
 * Money is DZD centimes as `bigint` everywhere (CLAUDE.md §7 Money).
 * 1 DA = 100 centimes. Never convert an amount to `number`.
 */
export type Centimes = bigint;

export type MoneyLocale = "fr" | "ar";

const CURRENCY_SYMBOL: Record<MoneyLocale, string> = { fr: "DA", ar: "د.ج" };

const formatters: Record<MoneyLocale, Intl.NumberFormat> = {
  fr: new Intl.NumberFormat("fr-DZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    numberingSystem: "latn",
  }),
  ar: new Intl.NumberFormat("ar-DZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    numberingSystem: "latn",
  }),
};

/** "1250000.50" — exact decimal string of dinars. */
export function toDecimalString(amount: Centimes): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const dinars = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${dinars}.${cents}`;
}

/**
 * `1 250 000,50 DA` (fr) · `1.250.000,50 د.ج` (ar). Latin digits in both locales.
 * Groups and currency are separated by U+00A0: Intl's narrow no-break space (U+202F)
 * is missing from many fonts, including the one embedded in PDFs.
 */
export function formatDZD(amount: Centimes, locale: MoneyLocale = "fr"): string {
  const number = formatters[locale]
    .format(toDecimalString(amount) as Intl.StringNumericLiteral)
    .replace(/\u202f/g, "\u00a0");
  return `${number}\u00a0${CURRENCY_SYMBOL[locale]}`;
}

/**
 * Parses user input in dinars into centimes: "1 250 000,50", "1250000.5", "300".
 * Spaces (incl. non-breaking) are ignored; "," or "." is the decimal separator.
 * Returns null for anything else (negative, more than 2 decimals, letters…).
 */
export function parseDZD(input: string): Centimes | null {
  const compact = input.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(compact);
  if (!match) return null;
  const [, dinars = "0", cents = ""] = match;
  return BigInt(dinars) * 100n + BigInt(cents.padEnd(2, "0") || "0");
}

export function sumCentimes(amounts: Iterable<Centimes>): Centimes {
  let total = 0n;
  for (const amount of amounts) total += amount;
  return total;
}

/** Rate in basis points (1 % = 100 bp), rounded half-up to the centime. */
export function applyRate(amount: Centimes, basisPoints: bigint | number): Centimes {
  const bp = BigInt(basisPoints);
  if (amount < 0n || bp < 0n) throw new RangeError("applyRate expects non-negative values");
  return (amount * bp + 5_000n) / 10_000n;
}

/**
 * Splits `total` proportionally to integer `weights` with the largest-remainder method:
 * parts always sum exactly to `total`. Ties go to the earliest index.
 */
export function allocate(total: Centimes, weights: ReadonlyArray<bigint | number>): Centimes[] {
  if (total < 0n) throw new RangeError("allocate expects a non-negative total");
  const w = weights.map((x) => BigInt(x));
  if (w.some((x) => x < 0n)) throw new RangeError("allocate expects non-negative weights");
  const weightSum = sumCentimes(w);
  if (weightSum === 0n) throw new RangeError("allocate needs at least one positive weight");

  const parts = w.map((x) => (total * x) / weightSum);
  let remainder = total - sumCentimes(parts);

  const byFraction = w
    .map((x, index) => ({ index, fraction: (total * x) % weightSum }))
    .sort((a, b) =>
      a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1,
    );

  for (const { index } of byFraction) {
    if (remainder === 0n) break;
    parts[index] = (parts[index] ?? 0n) + 1n;
    remainder -= 1n;
  }
  return parts;
}

const compactFormatters: Record<MoneyLocale, Intl.NumberFormat> = {
  fr: new Intl.NumberFormat("fr-DZ", {
    notation: "compact",
    maximumFractionDigits: 2,
    numberingSystem: "latn",
  }),
  ar: new Intl.NumberFormat("ar-DZ", {
    notation: "compact",
    maximumFractionDigits: 2,
    numberingSystem: "latn",
  }),
};

/** Short display for dense views (grids): `12,5 M DA`. Never for documents. */
export function formatCompactDZD(amount: Centimes, locale: MoneyLocale = "fr"): string {
  const number = compactFormatters[locale]
    .format(toDecimalString(amount) as Intl.StringNumericLiteral)
    .replace(/\u202f/g, "\u00a0");
  return `${number}\u00a0${CURRENCY_SYMBOL[locale]}`;
}

/**
 * `amount × (1 + basisPoints / 10 000)`, rounded half-up (away from zero) to the centime;
 * negative basis points lower the amount (never below zero). For price adjustments.
 */
export function adjustByBasisPoints(amount: Centimes, basisPoints: bigint | number): Centimes {
  const bp = BigInt(basisPoints);
  const scaled = amount * (10_000n + bp);
  const rounded = scaled >= 0n ? (scaled + 5_000n) / 10_000n : (scaled - 5_000n) / 10_000n;
  return rounded < 0n ? 0n : rounded;
}

/** "5" → 500, "-2,5" → -250, "0.25" → 25 basis points; null if not a percentage. */
export function parsePercentToBasisPoints(input: string): bigint | null {
  const match = /^(-?)(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(input.replace(/\s/g, ""));
  if (!match) return null;
  const [, sign = "", whole = "0", fraction = ""] = match;
  const bp = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  return sign === "-" ? -bp : bp;
}

/** Basis points as editable percent text: 1000 → "10", 250 → "2,5" (parsePercentToBasisPoints reads it back). */
export function formatPercentInput(bp: number | bigint): string {
  const value = BigInt(bp);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const fraction = (abs % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${sign}${abs / 100n}${fraction ? `,${fraction}` : ""}`;
}

/** Amount as editable text, e.g. "12 500 000,00" (French grouping, no currency); parseDZD reads it back. */
export function formatAmountInput(amount: Centimes): string {
  return formatters.fr
    .format(toDecimalString(amount) as Intl.StringNumericLiteral)
    .replace(/\u202f/g, "\u00a0");
}
