import "server-only";

import { inArray, eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { bankMatch } from "@/db/schema";

/**
 * A ledger entry that leaves (a payment or movement cancelled) undoes the bank matches of the
 * statement lines it was part of: those lines are to match again (CLAUDE.md §7 Treasury).
 */
export async function unmatchEntry(tx: Tx, entryKey: string): Promise<void> {
  const lines = await tx
    .select({ lineId: bankMatch.lineId })
    .from(bankMatch)
    .where(eq(bankMatch.entryKey, entryKey));
  if (lines.length === 0) return;
  await tx.delete(bankMatch).where(
    inArray(
      bankMatch.lineId,
      lines.map((l) => l.lineId),
    ),
  );
}
