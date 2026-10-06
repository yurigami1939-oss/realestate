import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { buyerDocumentKinds, civilities, documentStatuses, maritalStatuses } from "../../lib/sales";

import { id, organizationId, softDelete, timestamps, updatedAt, userRef } from "./_columns";
import { lead } from "./crm";
import { file } from "./files";

export const civility = pgEnum("civility", civilities);
export const maritalStatus = pgEnum("marital_status", maritalStatuses);
export const buyerDocumentKind = pgEnum("buyer_document_kind", buyerDocumentKinds);
export const documentStatus = pgEnum("document_status", documentStatuses);

/**
 * Acquéreur: legal identity printed on reservation sheets, receipts and payment calls (names in
 * Latin and Arabic script). Usually created from a lead. `ownerUserId` is the commercial who
 * follows them (commercials see their own buyers).
 */
export const buyer = pgTable(
  "buyer",
  {
    id: id(),
    organizationId: organizationId(),
    leadId: uuid(),
    ownerUserId: userRef(),
    civility: civility(),
    lastName: text().notNull(),
    firstName: text().notNull(),
    lastNameAr: text(),
    firstNameAr: text(),
    birthDate: date({ mode: "string" }),
    birthPlace: text(),
    fatherFirstName: text(),
    motherFullName: text(),
    /** Numéro d'identification national (18 digits). */
    nin: text(),
    idCardNumber: text(),
    idCardIssuedOn: date({ mode: "string" }),
    idCardIssuedBy: text(),
    phone: text().notNull(),
    phone2: text(),
    /** Agreed to WhatsApp notifications on `phone` (CLAUDE.md §7 WhatsApp). */
    whatsappOptIn: boolean().notNull().default(false),
    email: text(),
    address: text(),
    commune: text(),
    wilaya: text(),
    profession: text(),
    employer: text(),
    maritalStatus: maritalStatus(),
    notes: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "buyer_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }),
    uniqueIndex("buyer_nin_unique")
      .on(t.organizationId, t.nin)
      .where(sql`${t.nin} is not null and ${t.deletedAt} is null`),
    index().on(t.organizationId, t.leadId),
    index().on(t.organizationId, t.lastName),
  ],
);

/** One line of the buyer's document checklist, with its optional scan. */
export const buyerDocument = pgTable(
  "buyer_document",
  {
    organizationId: organizationId(),
    buyerId: uuid().notNull(),
    kind: buyerDocumentKind().notNull(),
    status: documentStatus().notNull().default("missing"),
    fileId: uuid(),
    note: text(),
    /** Last scan sent by the buyer from the portal (staff then verify it). */
    submittedFromPortal: boolean().notNull().default(false),
    updatedAt: updatedAt(),
    updatedBy: userRef(),
  },
  (t) => [
    primaryKey({ columns: [t.buyerId, t.kind] }),
    foreignKey({
      name: "buyer_document_buyer_fk",
      columns: [t.organizationId, t.buyerId],
      foreignColumns: [buyer.organizationId, buyer.id],
    }),
    foreignKey({
      name: "buyer_document_file_fk",
      columns: [t.organizationId, t.fileId],
      foreignColumns: [file.organizationId, file.id],
    }),
  ],
);
