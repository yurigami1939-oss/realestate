/**
 * Charge calls of a residence (CLAUDE.md §7 Residence charges). The annual budget of each
 * category is called in equal parts, one per period of the residence's frequency; each part is
 * split over the category's units by its distribution key with `allocate()`, so the lines
 * always sum exactly to the charge. The reserve fund (a share of the annual budget) is split
 * over every unit by tantièmes. Isomorphic: used by the issuing service and the preview.
 */
import { allocate, applyRate, type Centimes, sumCentimes } from "./money";
import {
  callsPerYear,
  type ChargeFrequency,
  type DistributionKey,
  type DistributionWeighting,
} from "./residences";

export type ChargeUnit = { unitId: string; buildingId: string; share: number };

export type ChargeCategory = {
  id: string;
  name: string;
  nameAr: string | null;
  key: DistributionKey;
  weighting: DistributionWeighting;
  /** Building of a `per_building` key. */
  buildingId: string | null;
  /** Units of a `custom` key. */
  unitIds: readonly string[];
};

/** Units a category is split over, with their weight (tantièmes or 1). */
export function categoryWeights(
  category: ChargeCategory,
  units: readonly ChargeUnit[],
): { unitId: string; weight: bigint }[] {
  const concerned = units.filter((u) => {
    switch (category.key) {
      case "share":
      case "equal":
        return true;
      case "per_building":
        return u.buildingId === category.buildingId;
      case "custom":
        return category.unitIds.includes(u.unitId);
    }
  });
  const byShare =
    category.key === "share" ||
    ((category.key === "per_building" || category.key === "custom") &&
      category.weighting === "share");
  return concerned.map((u) => ({ unitId: u.unitId, weight: byShare ? BigInt(u.share) : 1n }));
}

/** Part `index` (1-based) of an annual amount called in equal parts at `frequency`. */
export function periodPart(annual: Centimes, frequency: ChargeFrequency, index: number): Centimes {
  const n = callsPerYear[frequency];
  if (!Number.isInteger(index) || index < 1 || index > n) {
    throw new RangeError(`periodPart: period ${index} out of 1..${n}`);
  }
  return (
    allocate(
      annual,
      Array.from({ length: n }, () => 1n),
    )[index - 1] ?? 0n
  );
}

/** Reserve fund of a year: its share of the annual budget, half-up to the centime. */
export const annualReserve = (budgetTotal: Centimes, reserveFundBp: number): Centimes =>
  applyRate(budgetTotal, reserveFundBp);

export type ChargeCallLine = {
  /** Null for the reserve fund line. */
  categoryId: string | null;
  label: string;
  labelAr: string | null;
  amount: Centimes;
};

export type ChargeCallDraft = {
  unitId: string;
  lines: ChargeCallLine[];
  /** Total called, reserve fund included. */
  amount: Centimes;
  reserve: Centimes;
};

/** A part that cannot be split: no unit concerned, or no tantièmes on them. */
export type ChargeProblem = { categoryId: string | null; reason: "noUnits" | "noShares" };

/**
 * Calls of one period: for each unit, one line per category it bears plus the reserve fund
 * line; units with nothing to pay get no call. Categories keep the given order.
 */
export function buildChargeCalls(input: {
  units: readonly ChargeUnit[];
  categories: readonly (ChargeCategory & { annual: Centimes })[];
  frequency: ChargeFrequency;
  periodIndex: number;
  reserveFundBp: number;
  reserveLabel: { fr: string; ar: string };
}): { calls: ChargeCallDraft[]; total: Centimes; reserve: Centimes; problems: ChargeProblem[] } {
  const lines = new Map<string, ChargeCallLine[]>(input.units.map((u) => [u.unitId, []]));
  const problems: ChargeProblem[] = [];

  const split = (
    categoryId: string | null,
    label: { fr: string; ar: string | null },
    amount: Centimes,
    weights: { unitId: string; weight: bigint }[],
  ) => {
    if (amount === 0n) return;
    if (weights.length === 0) {
      problems.push({ categoryId, reason: "noUnits" });
      return;
    }
    if (weights.every((w) => w.weight === 0n)) {
      problems.push({ categoryId, reason: "noShares" });
      return;
    }
    const parts = allocate(
      amount,
      weights.map((w) => w.weight),
    );
    weights.forEach((w, index) => {
      const part = parts[index] ?? 0n;
      if (part > 0n) {
        lines.get(w.unitId)?.push({ categoryId, label: label.fr, labelAr: label.ar, amount: part });
      }
    });
  };

  for (const category of input.categories) {
    split(
      category.id,
      { fr: category.name, ar: category.nameAr },
      periodPart(category.annual, input.frequency, input.periodIndex),
      categoryWeights(category, input.units),
    );
  }
  const budgetTotal = sumCentimes(input.categories.map((c) => c.annual));
  const reserve = periodPart(
    annualReserve(budgetTotal, input.reserveFundBp),
    input.frequency,
    input.periodIndex,
  );
  split(
    null,
    input.reserveLabel,
    reserve,
    input.units.map((u) => ({ unitId: u.unitId, weight: BigInt(u.share) })),
  );

  const calls = input.units.flatMap((u): ChargeCallDraft[] => {
    const unitLines = lines.get(u.unitId) ?? [];
    const amount = sumCentimes(unitLines.map((l) => l.amount));
    if (amount === 0n) return [];
    const unitReserve = sumCentimes(
      unitLines.filter((l) => l.categoryId === null).map((l) => l.amount),
    );
    return [{ unitId: u.unitId, lines: unitLines, amount, reserve: unitReserve }];
  });
  return {
    calls,
    total: sumCentimes(calls.map((c) => c.amount)),
    reserve: sumCentimes(calls.map((c) => c.reserve)),
    problems,
  };
}

const monthsFr = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
/** Month names used in Algeria. */
const monthsAr = [
  "جانفي",
  "فيفري",
  "مارس",
  "أفريل",
  "ماي",
  "جوان",
  "جويلية",
  "أوت",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];
const ordinalsAr = ["الأول", "الثاني", "الثالث", "الرابع"];

/** Bilingual name of a call period, as printed on documents (`2e trimestre 2026`). */
export function periodLabels(
  frequency: ChargeFrequency,
  year: number,
  index: number,
): { fr: string; ar: string } {
  const ordinalFr = index === 1 ? "1er" : `${index}e`;
  switch (frequency) {
    case "monthly":
      return { fr: `${monthsFr[index - 1]} ${year}`, ar: `${monthsAr[index - 1]} ${year}` };
    case "quarterly":
      return {
        fr: `${ordinalFr} trimestre ${year}`,
        ar: `الثلاثي ${ordinalsAr[index - 1]} ${year}`,
      };
    case "half_yearly":
      return {
        fr: `${ordinalFr} semestre ${year}`,
        ar: `السداسي ${ordinalsAr[index - 1]} ${year}`,
      };
    case "yearly":
      return { fr: `Année ${year}`, ar: `سنة ${year}` };
  }
}
