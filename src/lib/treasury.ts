/**
 * Isomorphic: cash desks and bank accounts (CLAUDE.md §7 Treasury) — where each collection
 * lands, the manual movements, the ledger with its running balance.
 */
import type { CalendarDate } from "./dates";
import type { Centimes } from "./money";
import type { PaymentMethod } from "./sales";

/** Caisse (cash desk), compte bancaire, compte CCP. */
export const treasuryAccountKinds = ["cash", "bank", "ccp"] as const;
export type TreasuryAccountKind = (typeof treasuryAccountKinds)[number];

/**
 * Manual movements of an account: money in or out not recorded elsewhere (`income`,
 * `expense`, `bank_fee`), a `transfer` between two accounts (two rows), the `adjustment` of a
 * cash count's difference.
 */
export const movementKinds = ["income", "expense", "bank_fee", "transfer", "adjustment"] as const;
export type MovementKind = (typeof movementKinds)[number];

/** What staff record by hand (adjustments come from cash counts). */
export const manualMovementKinds = ["income", "expense", "bank_fee", "transfer"] as const;
export type ManualMovementKind = (typeof manualMovementKinds)[number];

export const movementDirections = ["in", "out"] as const;
export type MovementDirection = (typeof movementDirections)[number];

/** Accounts a payment method may land on: cash in a cash desk, the rest in a bank or CCP. */
export function accountKindsFor(method: PaymentMethod): TreasuryAccountKind[] {
  switch (method) {
    case "cash":
      return ["cash"];
    case "ccp":
      return ["ccp", "bank"];
    case "cheque":
    case "bank_transfer":
    case "bank_loan":
    case "card":
      return ["bank", "ccp"];
  }
}

/** The default account kind of a method (its first compatible kind). */
export const defaultKindFor = (method: PaymentMethod): TreasuryAccountKind =>
  accountKindsFor(method)[0] ?? "bank";

/** One line of an account's ledger: money in or out on a day. */
export type LedgerEntry = {
  on: CalendarDate;
  amountIn: Centimes;
  amountOut: Centimes;
};

/**
 * Running balance of an account's ledger: the opening balance, then each entry in order (by
 * day, as given), and the balance before `from` for a period's view.
 */
export function runningBalance<T extends LedgerEntry>(
  opening: Centimes,
  entries: readonly T[],
  from: CalendarDate | null = null,
): { before: Centimes; lines: (T & { balance: Centimes })[]; balance: Centimes } {
  let balance = opening;
  let before = opening;
  const lines: (T & { balance: Centimes })[] = [];
  for (const entry of entries) {
    balance += entry.amountIn - entry.amountOut;
    if (from !== null && entry.on < from) {
      before = balance;
      continue;
    }
    lines.push({ ...entry, balance });
  }
  return { before, lines, balance };
}

/** Where a cheque on a deposit slip was received: a sale, a residence's charges or a lease. */
export const chequeSources = ["sale", "charges", "rent"] as const;
export type ChequeSource = (typeof chequeSources)[number];
