import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { documentSequence } from "@/db/schema";
import type { TenantScope } from "@/db/tenant";
import { yearInAlgiers } from "@/lib/dates";
import { type DocumentType, formatDocumentNumber } from "@/lib/document-types";

export type DocumentNumber = { number: string; year: number; sequence: number };

/**
 * Allocates the next gapless number for a document type (CLAUDE.md §7 Document numbering).
 *
 * MUST be called with the transaction that inserts the document: the counter row stays
 * locked until commit, and a rollback releases the number, so no gap can appear.
 * The year is the Algiers year of the issue date.
 */
export async function nextDocumentNumber(
  tx: Tx,
  scope: TenantScope,
  docType: DocumentType,
  issuedAt: Date = new Date(),
): Promise<DocumentNumber> {
  const year = yearInAlgiers(issuedAt);

  await tx
    .insert(documentSequence)
    .values({ organizationId: scope.orgId, docType, year })
    .onConflictDoNothing();

  // UPDATE … RETURNING takes the row lock (same guarantee as SELECT … FOR UPDATE + UPDATE).
  const [row] = await tx
    .update(documentSequence)
    .set({ lastValue: sql`${documentSequence.lastValue} + 1` })
    .where(
      and(
        eq(documentSequence.organizationId, scope.orgId),
        eq(documentSequence.docType, docType),
        eq(documentSequence.year, year),
      ),
    )
    .returning({ lastValue: documentSequence.lastValue });

  if (!row) throw new Error(`nextDocumentNumber: counter missing for ${docType}/${year}`);
  return {
    number: formatDocumentNumber(docType, year, row.lastValue),
    year,
    sequence: row.lastValue,
  };
}
