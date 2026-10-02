import type { Centimes } from "./money";

/**
 * Arabic amount in words (Modern Standard Arabic), e.g.
 * 1 250 000,50 DA → "مليون ومائتان وخمسون ألف دينار جزائري وخمسون سنتيماً".
 *
 * Counted-noun agreement follows the last two digits of the count:
 *   1 → "دينار جزائري واحد", 2 → dual, 3–10 → plural, 11–99 → accusative singular,
 *   0 (round hundreds, thousands…) → genitive singular. Remainders 1–2 above 100 keep the
 *   genitive singular ("مائة وواحد دينار"), the usual simplification of accounting documents.
 * All numbers use masculine counted nouns (دينار، سنتيم، ألف، مليون، مليار), so 3–10 take "ة".
 */

const UNITS = [
  "صفر", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة",
] as const; // prettier-ignore

const TEENS: Record<number, string> = { 11: "أحد عشر", 12: "اثنا عشر" };

const TENS = [
  "",
  "",
  "عشرون",
  "ثلاثون",
  "أربعون",
  "خمسون",
  "ستون",
  "سبعون",
  "ثمانون",
  "تسعون",
] as const;

const HUNDREDS = [
  "", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة",
] as const; // prettier-ignore

type NounForms = {
  singular: string;
  dual: string;
  /** construct dual, used when a noun follows directly: "ألفا دينار" */
  dualConstruct: string;
  plural: string;
  accusative: string;
};

const SCALES: ReadonlyArray<{ value: number; forms: NounForms }> = [
  {
    value: 1_000_000_000,
    forms: {
      singular: "مليار",
      dual: "ملياران",
      dualConstruct: "مليارا",
      plural: "مليارات",
      accusative: "ملياراً",
    },
  },
  {
    value: 1_000_000,
    forms: {
      singular: "مليون",
      dual: "مليونان",
      dualConstruct: "مليونا",
      plural: "ملايين",
      accusative: "مليوناً",
    },
  },
  {
    value: 1_000,
    forms: {
      singular: "ألف",
      dual: "ألفان",
      dualConstruct: "ألفا",
      plural: "آلاف",
      accusative: "ألفاً",
    },
  },
];

/** Largest supported integer part: < 10^12. */
const MAX = 1_000_000_000_000n;

const DINAR = {
  one: "دينار جزائري واحد",
  dual: "ديناران جزائريان",
  plural: "دنانير جزائرية",
  accusative: "ديناراً جزائرياً",
  genitive: "دينار جزائري",
};

const CENTIME = {
  one: "سنتيم واحد",
  dual: "سنتيمان",
  plural: "سنتيمات",
  accusative: "سنتيماً",
  genitive: "سنتيم",
};

const unit = (n: number): string => UNITS[n] ?? "";

/** 1–99, nominative. */
function below100(n: number): string {
  if (n <= 10) return unit(n);
  if (n < 20) return TEENS[n] ?? `${unit(n - 10)} عشر`;
  const units = n % 10;
  const tens = TENS[Math.floor(n / 10)] ?? "";
  return units === 0 ? tens : `${unit(units)} و${tens}`;
}

/** 1–999. `beforeNoun`: a noun follows directly, so "مائتان" becomes "مائتا". */
function below1000(n: number, beforeNoun: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) {
    const word = HUNDREDS[hundreds] ?? "";
    parts.push(rest === 0 && beforeNoun && hundreds === 2 ? "مائتا" : word);
  }
  if (rest > 0) parts.push(below100(rest));
  return parts.join(" و");
}

type Agreement = "one" | "dual" | "plural" | "accusative" | "genitive";

function agreement(count: number): Agreement {
  if (count === 1) return "one";
  if (count === 2) return "dual";
  const lastTwo = count % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return "plural";
  if (lastTwo >= 11) return "accusative";
  return "genitive";
}

/** A scale group ("ثلاثة آلاف", "خمسون ألفاً"…). `last`: the currency noun follows directly. */
function scaleGroup(count: number, forms: NounForms, last: boolean): string {
  switch (agreement(count)) {
    case "one":
      return forms.singular;
    case "dual":
      return last ? forms.dualConstruct : forms.dual;
    case "plural":
      return `${below1000(count, true)} ${forms.plural}`;
    case "accusative":
      // In construct with the currency noun the tanween drops: "خمسون ألف دينار".
      return `${below1000(count, true)} ${last ? forms.singular : forms.accusative}`;
    case "genitive":
      return `${below1000(count, true)} ${forms.singular}`;
  }
}

/** Number words followed by the agreeing noun; the whole phrase for 1 and 2. */
function countedPhrase(value: number, noun: typeof DINAR): string {
  const form = agreement(value);
  if (form === "one") return noun.one;
  if (form === "dual") return noun.dual;

  let rest = value;
  const parts: string[] = [];
  for (const scale of SCALES) {
    const count = Math.floor(rest / scale.value);
    rest %= scale.value;
    if (count > 0) parts.push(scaleGroup(count, scale.forms, rest === 0));
  }
  if (rest > 0) parts.push(below1000(rest, true));
  return `${parts.join(" و")} ${noun[form]}`;
}

/** Integer in words without a counted noun: 1 250 000 → "مليون ومائتان وخمسون ألف". */
export function integerToWordsAr(value: bigint): string {
  if (value < 0n || value >= MAX) throw new RangeError(`integerToWordsAr: out of range (${value})`);
  if (value === 0n) return unit(0);
  let rest = Number(value);
  const parts: string[] = [];
  for (const scale of SCALES) {
    const count = Math.floor(rest / scale.value);
    rest %= scale.value;
    if (count > 0) parts.push(scaleGroup(count, scale.forms, false));
  }
  if (rest > 0) parts.push(below1000(rest, false));
  return parts.join(" و");
}

export function amountInWordsAr(amount: Centimes): string {
  if (amount < 0n) throw new RangeError("amountInWordsAr expects a non-negative amount");
  const dinars = amount / 100n;
  const centimes = Number(amount % 100n);
  if (dinars >= MAX) throw new RangeError(`amountInWordsAr: out of range (${amount})`);

  const dinarsPart =
    dinars === 0n ? `${unit(0)} ${DINAR.genitive}` : countedPhrase(Number(dinars), DINAR);
  if (centimes === 0) return dinarsPart;
  const centimesPart = countedPhrase(centimes, CENTIME);
  if (dinars === 0n) return centimesPart;
  return `${dinarsPart} و${centimesPart}`;
}
