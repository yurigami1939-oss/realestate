import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  accessSubjects,
  consentPurposes,
  consentSources,
  consentSubjects,
} from "../../lib/privacy";

import { createdAt, id, instant, organizationId, userRef } from "./_columns";

export const consentPurpose = pgEnum("consent_purpose", consentPurposes);
export const consentSource = pgEnum("consent_source", consentSources);
export const consentSubject = pgEnum("consent_subject", consentSubjects);
export const accessSubject = pgEnum("access_subject", accessSubjects);

/**
 * Each consent given or withdrawn (CLAUDE.md §7 Personal data): the proof Loi 18-07 asks for —
 * whose, for what, how and who recorded it. Append-only; the records keep the current state.
 */
export const consentEvent = pgTable(
  "consent_event",
  {
    id: id(),
    organizationId: organizationId(),
    subjectType: consentSubject().notNull(),
    subjectId: uuid().notNull(),
    purpose: consentPurpose().notNull(),
    granted: boolean().notNull(),
    source: consentSource().notNull(),
    /** The phone the « STOP » came from, or another detail. */
    detail: text(),
    actorUserId: userRef(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.organizationId, t.subjectType, t.subjectId)],
);

/**
 * Who opened a person's file (CLAUDE.md §7 Personal data): one row per member, file and Algiers
 * day, with the first and last time and how many times. Never deleted.
 */
export const dataAccess = pgTable(
  "data_access",
  {
    id: id(),
    organizationId: organizationId(),
    userId: userRef().notNull(),
    subjectType: accessSubject().notNull(),
    subjectId: uuid().notNull(),
    day: date({ mode: "string" }).notNull(),
    firstAt: instant().notNull(),
    lastAt: instant().notNull(),
    count: integer().notNull().default(1),
  },
  (t) => [
    uniqueIndex("data_access_daily").on(
      t.organizationId,
      t.subjectType,
      t.subjectId,
      t.userId,
      t.day,
    ),
  ],
);
