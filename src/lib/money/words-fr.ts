import type { Centimes } from "./money";

/**
 * French amount in words, traditional spelling (as used on Algerian receipts):
 * "vingt et un", "quatre-vingts", "deux cents" but "deux cent mille", "deux cents millions".
 */

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
] as const; // prettier-ignore

const TENS: Record<number, string> = {
  2: "vingt",
  3: "trente",
  4: "quarante",
  5: "cinquante",
  6: "soixante",
};

/** Largest supported integer part: < 10^15 dinars. */
const MAX = 1_000_000_000_000_000n;

const SCALES = [
  { value: 1_000_000_000_000, name: "billion" },
  { value: 1_000_000_000, name: "milliard" },
  { value: 1_000_000, name: "million" },
  { value: 1_000, name: "mille" },
] as const;

const unit = (n: number): string => UNITS[n] ?? "";

/** 1–99. `final`: nothing follows except a noun that allows plural agreement. */
function below100(n: number, final: boolean): string {
  if (n <= 16) return unit(n);
  if (n < 20) return `dix-${unit(n - 10)}`;
  const tens = Math.floor(n / 10);
  const units = n % 10;
  if (tens === 7) return n === 71 ? "soixante et onze" : `soixante-${below100(n - 60, final)}`;
  if (tens === 8)
    return units === 0 ? (final ? "quatre-vingts" : "quatre-vingt") : `quatre-vingt-${unit(units)}`;
  if (tens === 9) return `quatre-vingt-${below100(n - 80, final)}`;
  const word = TENS[tens] ?? "";
  if (units === 0) return word;
  if (units === 1) return `${word} et un`;
  return `${word}-${unit(units)}`;
}

/** 1–999. */
function below1000(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const words: string[] = [];
  if (hundreds === 1) words.push("cent");
  else if (hundreds > 1) words.push(`${unit(hundreds)} ${rest === 0 && final ? "cents" : "cent"}`);
  if (rest > 0) words.push(below100(rest, final));
  return words.join(" ");
}

/** Integer in words: 0 → "zéro", 1_250_000 → "un million deux cent cinquante mille". */
export function integerToWordsFr(value: bigint): string {
  if (value < 0n || value >= MAX) throw new RangeError(`integerToWordsFr: out of range (${value})`);
  if (value === 0n) return "zéro";
  let rest = Number(value);
  const parts: string[] = [];
  for (const scale of SCALES) {
    const count = Math.floor(rest / scale.value);
    rest %= scale.value;
    if (count === 0) continue;
    if (scale.name === "mille") {
      // "mille" is invariable and never preceded by "un"; "cent"/"vingt" do not agree before it.
      parts.push(count === 1 ? "mille" : `${below1000(count, false)} mille`);
    } else {
      // million/milliard/billion are nouns: they agree and let "cents"/"quatre-vingts" agree.
      parts.push(`${below1000(count, true)} ${scale.name}${count > 1 ? "s" : ""}`);
    }
  }
  if (rest > 0) parts.push(below1000(rest, true));
  return parts.join(" ");
}

/**
 * "un million deux cent cinquante mille dinars algériens et cinquante centimes".
 * Round millions take "de": "deux millions de dinars algériens".
 */
export function amountInWordsFr(amount: Centimes): string {
  if (amount < 0n) throw new RangeError("amountInWordsFr expects a non-negative amount");
  const dinars = amount / 100n;
  const centimes = amount % 100n;

  const de = dinars >= 1_000_000n && dinars % 1_000_000n === 0n ? "de " : "";
  const currency = dinars <= 1n ? "dinar algérien" : "dinars algériens";
  const dinarsPart = `${integerToWordsFr(dinars)} ${de}${currency}`;
  const centimesPart = `${integerToWordsFr(centimes)} ${centimes === 1n ? "centime" : "centimes"}`;

  if (centimes === 0n) return dinarsPart;
  if (dinars === 0n) return centimesPart;
  return `${dinarsPart} et ${centimesPart}`;
}
