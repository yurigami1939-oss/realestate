import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { documentTypes } from "../../lib/document-types";

import { createdAt, id, organizationId, userRef } from "./_columns";

export const documentType = pgEnum("document_type", documentTypes);

/**
 * Gapless counters per organization, document type and (Algiers) year.
 * Only src/server/numbering touches it, always inside the business transaction.
 */
export const documentSequence = pgTable(
  "document_sequence",
  {
    organizationId: organizationId(),
    docType: documentType().notNull(),
    year: smallint().notNull(),
    lastValue: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.docType, t.year] })],
);

/**
 * Append-only journal of sensitive mutations (CLAUDE.md §7 Audit).
 * The app role has no UPDATE/DELETE grant on this table.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: organizationId(),
    /** null when the change comes from a background job. */
    actorUserId: userRef(),
    /** Semantic action, e.g. `receipt.cancel`. */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.organizationId, t.entityType, t.entityId),
    index().on(t.organizationId, t.createdAt),
  ],
);
