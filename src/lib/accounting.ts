/**
 * Isomorphic: the accounting export (CLAUDE.md §7 Treasury). Every flow of a treasury account
 * becomes a two-line entry: the account's own code against a counterpart chosen by the flow's
 * nature. Codes follow the SCF; each organization adjusts them to its chartered accountant's
 * chart (`accounting_codes`).
 */
import type { TreasuryAccountKind } from "./treasury";

/** The counterparts of the flows, by nature. */
export const accountingKeys = [
  "clients",
  "coOwners",
  "tenants",
  "deposits",
  "suppliers",
  "contractors",
  "staff",
  "staffAdvances",
  "partners",
  "bankFees",
  "expenses",
  "income",
  "transfers",
  "cashShort",
  "cashOver",
] as const;
export type AccountingKey = (typeof accountingKeys)[number];
export type AccountingCodes = Record<AccountingKey, string>;

/** Defaults (SCF), to be adjusted with the chartered accountant. */
export const defaultAccountingCodes: AccountingCodes = {
  clients: "411000",
  coOwners: "467000",
  tenants: "411100",
  deposits: "165000",
  suppliers: "401000",
  contractors: "401100",
  staff: "421000",
  staffAdvances: "425000",
  partners: "622000",
  bankFees: "627000",
  expenses: "628000",
  income: "758000",
  transfers: "581000",
  cashShort: "658000",
  cashOver: "758000",
};

/** A treasury account's own code and journal when none is set: caisse 53, banque 512, CCP 517. */
export const defaultTreasuryCodes: Record<TreasuryAccountKind, { code: string; journal: string }> =
  {
    cash: { code: "530000", journal: "CA" },
    bank: { code: "512000", journal: "BQ" },
    ccp: { code: "517000", journal: "CCP" },
  };

/** The saved codes over the defaults (blank or unknown keys ignored). */
export function accountingCodes(saved: Partial<Record<string, string>> | null): AccountingCodes {
  const codes = { ...defaultAccountingCodes };
  for (const key of accountingKeys) {
    const value = saved?.[key]?.trim();
    if (value) codes[key] = value;
  }
  return codes;
}

/** Ledger sources (and a rent payment that is a deposit) → the counterpart's key. */
export function counterpartKey(
  source: string,
  options: { deposit?: boolean; direction: "in" | "out" },
): AccountingKey {
  switch (source) {
    case "sale":
    case "refund":
      return "clients";
    case "charges":
      return "coOwners";
    case "rent":
      return options.deposit ? "deposits" : "tenants";
    case "deposit_refund":
      return "deposits";
    case "supplier":
      return "suppliers";
    case "works":
    case "retention":
      return "contractors";
    case "staff_pay":
      return "staff";
    case "advance":
      return "staffAdvances";
    case "partner_commission":
      return "partners";
    case "bank_fee":
      return "bankFees";
    case "income":
      return "income";
    case "transfer":
      return "transfers";
    case "adjustment":
      return options.direction === "in" ? "cashOver" : "cashShort";
    default:
      return "expenses";
  }
}
