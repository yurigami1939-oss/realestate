import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { signableDocuments } from "../../lib/signatures";

import { createdAt, id, instant, organizationId, userRef } from "./_columns";
import { file } from "./files";

export const signedDocument = pgEnum("signed_document", signableDocuments);

/**
 * A document signed electronically from the portal (CLAUDE.md §7 Electronic signature): who,
 * when, from which address and browser, and the SHA-256 of the stored PDF as it was signed — a
 * simple electronic signature with its proof. Append-only (grants); one per document and account.
 */
export const eSignature = pgTable(
  "e_signature",
  {
    id: id(),
    organizationId: organizationId(),
    documentType: signedDocument().notNull(),
    documentId: uuid().notNull(),
    /** The PDF signed. */
    fileId: uuid().notNull(),
    documentSha256: text().notNull(),
    signerUserId: userRef().notNull(),
    /** As the account was named and reached when signing. */
    signerName: text().notNull(),
    signerEmail: text().notNull(),
    signedAt: instant().notNull().defaultNow(),
    ipAddress: text(),
    userAgent: text(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("e_signature_signer_key").on(
      t.organizationId,
      t.documentType,
      t.documentId,
      t.signerUserId,
    ),
    index().on(t.organizationId, t.documentType, t.documentId),
    foreignKey({
      name: "e_signature_file_fk",
      columns: [t.organizationId, t.fileId],
      foreignColumns: [file.organizationId, file.id],
    }),
  ],
);

/** A one-time code e-mailed to sign a document: kept hashed, short-lived, a few tries. */
export const signatureCode = pgTable(
  "signature_code",
  {
    id: id(),
    organizationId: organizationId(),
    userId: userRef().notNull(),
    documentType: signedDocument().notNull(),
    documentId: uuid().notNull(),
    codeHash: text().notNull(),
    expiresAt: instant().notNull(),
    attempts: integer().notNull().default(0),
    usedAt: instant(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.organizationId, t.userId, t.documentType, t.documentId)],
);
