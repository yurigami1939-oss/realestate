import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { ConsoleTx } from "@/db/console-client";
import { consoleDocumentSequence, type consoleDocumentType } from "@/db/schema";
import type { CalendarDate } from "@/lib/dates";

export type ConsoleDocumentType = (typeof consoleDocumentType.enumValues)[number];

const prefixes: Record<ConsoleDocumentType, string> = { invoice: "FAC", credit_note: "AVO" };

/**
 * The next gapless number of an operator invoice (`FAC-2026-000001`) or credit note (`AVO-`):
 * root CLAUDE.md §7's format and guarantees — call it in the transaction that inserts the
 * document (the counter row stays locked until commit; a rollback leaves no gap). The year is
 * the issue day's.
 */
export async function nextConsoleNumber(
  tx: ConsoleTx,
  docType: ConsoleDocumentType,
  issuedOn: CalendarDate,
): Promise<{ number: string; year: number; sequence: number }> {
  const year = Number(issuedOn.slice(0, 4));
  await tx.insert(consoleDocumentSequence).values({ docType, year }).onConflictDoNothing();
  const [row] = await tx
    .update(consoleDocumentSequence)
    .set({ lastValue: sql`${consoleDocumentSequence.lastValue} + 1` })
    .where(
      and(eq(consoleDocumentSequence.docType, docType), eq(consoleDocumentSequence.year, year)),
    )
    .returning({ lastValue: consoleDocumentSequence.lastValue });
  if (!row) throw new Error(`nextConsoleNumber: counter missing for ${docType}/${year}`);
  return {
    number: `${prefixes[docType]}-${year}-${String(row.lastValue).padStart(6, "0")}`,
    year,
    sequence: row.lastValue,
  };
}
