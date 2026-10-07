/**
 * Isomorphic: logement promotionnel aidé (LPA) — the CNL's aid to buyers and subsidised-rate
 * loans (CLAUDE.md §7 After the reservation). Every figure (SNMG, income ceiling, aid and rate
 * brackets) is an organization setting kept up to date with the decrees: nothing is hard-coded,
 * and the checks only warn.
 */
import type { Centimes } from "./money";

/** A project sold on the free market or as logement promotionnel aidé. */
export const housingPrograms = ["free", "lpa"] as const;
export type HousingProgram = (typeof housingPrograms)[number];

/** Income multiples of the SNMG are kept in hundredths (600 = 6 × SNMG). */
export type AidBracket<T> = { maxMultiple: number } & T;

export type HousingAidSettings = {
  /** Salaire national minimum garanti, monthly, in centimes (null = not set: no check). */
  snmg: Centimes | null;
  /** Highest household income for LPA, in hundredths of the SNMG (null = no ceiling). */
  lpaMaxMultiple: number | null;
  /** The CNL's aid by household income bracket (ascending). */
  cnlBrackets: AidBracket<{ amount: Centimes }>[];
  /** Subsidised loan rates (basis points) by household income bracket (ascending). */
  rateBrackets: AidBracket<{ rateBp: number }>[];
};

/** As stored (JSON: amounts as centime strings). */
export type StoredHousingAid = {
  snmg?: string | null;
  lpaMaxMultiple?: number | null;
  cnlBrackets?: { maxMultiple: number; amount: string }[];
  rateBrackets?: { maxMultiple: number; rateBp: number }[];
};

export function housingAidSettings(stored: StoredHousingAid | null): HousingAidSettings {
  const byCeiling = <T extends { maxMultiple: number }>(rows: T[]) =>
    [...rows].sort((a, b) => a.maxMultiple - b.maxMultiple);
  return {
    snmg: stored?.snmg ? BigInt(stored.snmg) : null,
    lpaMaxMultiple: stored?.lpaMaxMultiple ?? null,
    cnlBrackets: byCeiling(
      (stored?.cnlBrackets ?? []).map((b) => ({
        maxMultiple: b.maxMultiple,
        amount: BigInt(b.amount),
      })),
    ),
    rateBrackets: byCeiling(stored?.rateBrackets ?? []),
  };
}

export function storeHousingAid(settings: HousingAidSettings): StoredHousingAid {
  return {
    snmg: settings.snmg?.toString() ?? null,
    lpaMaxMultiple: settings.lpaMaxMultiple,
    cnlBrackets: settings.cnlBrackets.map((b) => ({
      maxMultiple: b.maxMultiple,
      amount: b.amount.toString(),
    })),
    rateBrackets: settings.rateBrackets,
  };
}

export const aidIssues = [
  "notConfigured",
  "incomeMissing",
  "incomeAbove",
  "ownsHome",
  "previousAid",
] as const;
export type AidIssue = (typeof aidIssues)[number];

export type HousingAidCheck = {
  /** Household income in hundredths of the SNMG (null without income or SNMG). */
  multiple: number | null;
  issues: AidIssue[];
  /** The CNL's aid of the household's bracket (null when none applies). */
  cnlAid: Centimes | null;
  /** The subsidised rate of the household's bracket (null when none applies). */
  rateBp: number | null;
};

/**
 * Where a household stands for LPA with the organization's settings: its income as a multiple
 * of the SNMG (rounded down to the hundredth), the issues (no settings, no income, income above
 * the ceiling, already a home owner or already aided) and the aid and rate of its bracket.
 */
export function housingAidCheck(
  household: { income: Centimes | null; ownsHome: boolean | null; previousAid: boolean | null },
  settings: HousingAidSettings,
): HousingAidCheck {
  const issues: AidIssue[] = [];
  if (household.ownsHome) issues.push("ownsHome");
  if (household.previousAid) issues.push("previousAid");
  if (settings.snmg === null || settings.snmg <= 0n) {
    return { multiple: null, issues: ["notConfigured", ...issues], cnlAid: null, rateBp: null };
  }
  if (household.income === null) {
    return { multiple: null, issues: ["incomeMissing", ...issues], cnlAid: null, rateBp: null };
  }
  const multiple = Number((household.income * 100n) / settings.snmg);
  const within = (max: number) =>
    household.income !== null && household.income * 100n <= BigInt(max) * (settings.snmg ?? 0n);
  if (settings.lpaMaxMultiple !== null && !within(settings.lpaMaxMultiple)) {
    issues.unshift("incomeAbove");
  }
  const eligible = issues.length === 0;
  return {
    multiple,
    issues,
    cnlAid: eligible
      ? (settings.cnlBrackets.find((b) => within(b.maxMultiple))?.amount ?? null)
      : null,
    rateBp: settings.rateBrackets.find((b) => within(b.maxMultiple))?.rateBp ?? null,
  };
}
