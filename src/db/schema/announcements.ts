import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { announcementCategories } from "../../lib/announcements";

import { id, instant, organizationId, timestamps, userRef } from "./_columns";
import { file } from "./files";
import { residence } from "./residences";

export const announcementCategory = pgEnum("announcement_category", announcementCategories);

/**
 * Annonce of a residence to its residents: written as a draft, then published (a bilingual
 * notice is printed to post in the building; residents will read it on the portal) and
 * withdrawn when no longer relevant (CLAUDE.md §12).
 */
export const announcement = pgTable(
  "announcement",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    category: announcementCategory().notNull().default("general"),
    title: text().notNull(),
    titleAr: text(),
    body: text().notNull(),
    bodyAr: text(),
    /** Last day it is shown (null: until withdrawn). */
    expiresOn: date({ mode: "string" }),
    /** Shown first. */
    pinned: boolean().notNull().default(false),
    publishedAt: instant(),
    publishedBy: userRef(),
    archivedAt: instant(),
    archivedBy: userRef(),
    /** Printable bilingual notice, rendered once at publication. */
    pdfFileId: uuid(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "announcement_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "announcement_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.residenceId, t.publishedAt),
    check("announcement_archived", sql`${t.archivedAt} is null or ${t.publishedAt} is not null`),
  ],
);
