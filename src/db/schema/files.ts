import { index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { createdAt, id, instant, organizationId, userRef } from "./_columns";

/** Metadata of an object stored in S3 (CLAUDE.md §5 Files). The bytes live in the private bucket. */
export const file = pgTable(
  "file",
  {
    id: id(),
    organizationId: organizationId(),
    /** `org/{orgId}/{entityType}/{entityId}/{fileId}.{ext}` */
    storageKey: text().notNull(),
    fileName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    /** What the file belongs to, e.g. `unit` + unit id for a floor plan. */
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    uploadedBy: userRef(),
    createdAt: createdAt(),
    deletedAt: instant(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.storageKey),
    index().on(t.organizationId, t.entityType, t.entityId),
  ],
);
