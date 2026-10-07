/**
 * Isomorphic: the accounting export (CLAUDE.md §7 Treasury). Every flow of a treasury account
 * becomes a two-line entry: the account's own code against a counterpart chosen by the flow's
 * nature; sales, rents and charge calls become revenue entries (receivable against revenue and
 * VAT). Codes follow the SCF; each organization adjusts them to its chartered accountant's chart
 * (`accounting_codes`) and sets its tax rates (`tax_settings`): nothing fiscal is hard-coded.
 */
import type { Centimes } from "./money";
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
  "salesRevenue",
  "rentRevenue",
  "chargesCalled",
  "reserveFund",
  "vatCollected",
  "salesJournal",
  "chargesJournal",
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
  salesRevenue: "702000",
  rentRevenue: "706000",
  chargesCalled: "708000",
  reserveFund: "467100",
  vatCollected: "445700",
  salesJournal: "VT",
  chargesJournal: "OD",
};

/** When a sale's revenue is booked: at the VSP signed at the notary, or at the handover PV. */
export const revenueEvents = ["vsp", "handover"] as const;
export type RevenueEvent = (typeof revenueEvents)[number];

/**
 * The organization's tax settings, set with its accountant (0 % = no VAT line): VAT on sales
 * and on rents by lease kind (prices and rents are TTC), and the stamp duty on cash receipts
 * shown on the G50 worksheet.
 */
export type TaxSettings = {
  revenueEvent: RevenueEvent;
  vatSalesBp: number;
  vatRentCommercialBp: number;
  vatRentResidentialBp: number;
  stampDutyBp: number;
};

export const defaultTaxSettings: TaxSettings = {
  revenueEvent: "vsp",
  vatSalesBp: 0,
  vatRentCommercialBp: 0,
  vatRentResidentialBp: 0,
  stampDutyBp: 0,
};

/** The saved settings over the defaults. */
export function taxSettings(saved: Partial<TaxSettings> | null): TaxSettings {
  return { ...defaultTaxSettings, ...saved };
}

/**
 * Splits an amount TTC into HT and VAT at a rate in basis points: HT = TTC / (1 + rate),
 * rounded half-up to the centime, VAT = the rest (so both always sum to the TTC).
 */
export function vatSplit(ttc: Centimes, rateBp: number): { ht: Centimes; vat: Centimes } {
  if (rateBp <= 0) return { ht: ttc, vat: 0n };
  const base = 10_000n + BigInt(rateBp);
  const ht = (ttc * 10_000n * 2n + base) / (base * 2n);
  return { ht, vat: ttc - ht };
}

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
