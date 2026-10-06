/** Isomorphic: bank reconciliation (rapprochement bancaire, CLAUDE.md §7 Treasury). */
import type { CalendarDate } from "./dates";
import type { Centimes } from "./money";

/** A ledger entry matched one-to-one: same signed amount, at most this many days apart. */
export const MATCH_DAYS = 10;
/** A deposit slip credited by the bank within this many days of its deposit. */
export const SLIP_DAYS = 20;

export type StatementLineToMatch = { id: string; bookedOn: CalendarDate; amount: Centimes };
/** A ledger entry not matched yet: `amount` signed (money in > 0). */
export type EntryToMatch = { key: string; on: CalendarDate; amount: Centimes };
/** A cheque deposit slip: its cheques' entry keys and their total. */
export type SlipToMatch = {
  number: string;
  depositedOn: CalendarDate;
  keys: string[];
  amount: Centimes;
};
export type MatchSuggestion = { keys: string[]; slip: string | null };

const dayNumber = (day: CalendarDate) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
const daysApart = (a: CalendarDate, b: CalendarDate) => Math.abs(dayNumber(a) - dayNumber(b));

/**
 * What each open statement line probably is: the one entry of the same amount closest in time
 * (within `MATCH_DAYS`; none when two are as close), else — for a credit — the one deposit slip
 * of that total credited within `SLIP_DAYS` of its deposit whose cheques are all unmatched. Each
 * entry is suggested once, to the earliest line.
 */
export function suggestMatches(
  lines: readonly StatementLineToMatch[],
  entries: readonly EntryToMatch[],
  slips: readonly SlipToMatch[] = [],
): Map<string, MatchSuggestion> {
  const used = new Set<string>();
  const suggestions = new Map<string, MatchSuggestion>();
  const ordered = [...lines].sort((a, b) => (a.bookedOn < b.bookedOn ? -1 : 1));
  for (const line of ordered) {
    const candidates = entries
      .filter(
        (e) =>
          !used.has(e.key) &&
          e.amount === line.amount &&
          daysApart(e.on, line.bookedOn) <= MATCH_DAYS,
      )
      .map((e) => ({ key: e.key, distance: daysApart(e.on, line.bookedOn) }))
      .sort((a, b) => a.distance - b.distance);
    const [best, next] = candidates;
    if (best && (!next || next.distance > best.distance)) {
      used.add(best.key);
      suggestions.set(line.id, { keys: [best.key], slip: null });
    }
  }
  for (const line of ordered) {
    if (suggestions.has(line.id) || line.amount <= 0n) continue;
    const fitting = slips.filter(
      (s) =>
        s.amount === line.amount &&
        s.depositedOn <= line.bookedOn &&
        daysApart(s.depositedOn, line.bookedOn) <= SLIP_DAYS &&
        s.keys.length > 0 &&
        s.keys.every((k) => !used.has(k) && entries.some((e) => e.key === k)),
    );
    const [slip, other] = fitting;
    if (slip && !other) {
      for (const key of slip.keys) used.add(key);
      suggestions.set(line.id, { keys: slip.keys, slip: slip.number });
    }
  }
  return suggestions;
}
