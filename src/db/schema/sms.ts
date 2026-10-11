import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { smsProviders, smsStatuses } from "../../lib/sms";
import type { WhatsappKind } from "../../lib/whatsapp";

import { createdAt, id, instant, organizationId, updatedAt, userRef } from "./_columns";
import { whatsappKind, whatsappLanguage } from "./whatsapp";

export const smsProvider = pgEnum("sms_provider", smsProviders);
export const smsStatus = pgEnum("sms_status", smsStatuses);

/**
 * The organization's SMS account (CLAUDE.md §7 SMS): its operator's or aggregator's HTTP
 * gateway, the registered sender name and the API key (encrypted, src/server/secrets.ts); the
 * notifications sent by SMS and their language.
 */
export const smsAccount = pgTable("sms_account", {
  organizationId: organizationId().primaryKey(),
  enabled: boolean().notNull().default(false),
  provider: smsProvider().notNull(),
  /** The gateway's base URL (empty: the local stand-in where it is on). */
  apiUrl: text(),
  sender: text().notNull(),
  apiKeyEncrypted: text().notNull(),
  language: whatsappLanguage().notNull().default("fr"),
  kinds: whatsappKind()
    .array()
    .$type<WhatsappKind[]>()
    .notNull()
    .default(sql`'{}'`),
  updatedAt: updatedAt(),
  updatedBy: userRef(),
});

/**
 * One SMS to one person, queued in the transaction of the event it reports and sent by the
 * worker (`sms.send`). Never deleted.
 */
export const smsMessage = pgTable(
  "sms_message",
  {
    id: id(),
    organizationId: organizationId(),
    /** The notification (`null`: a test message from the settings page). */
    kind: whatsappKind(),
    /** E.164 mobile number. */
    recipient: text().notNull(),
    recipientName: text().notNull(),
    text: text().notNull(),
    segments: integer().notNull(),
    /** The record it is about (sale, residence, lease), for the log's link. */
    refType: text(),
    refId: uuid(),
    status: smsStatus().notNull().default("queued"),
    /** The gateway's message id once accepted. */
    providerId: text(),
    error: text(),
    sentAt: instant(),
    failedAt: instant(),
    createdBy: userRef(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.organizationId, t.id), index().on(t.organizationId, t.createdAt)],
);

/** Numbers that asked not to receive SMS any more (« STOP »): nothing is sent to them. */
export const smsOptOut = pgTable(
  "sms_opt_out",
  {
    id: id(),
    organizationId: organizationId(),
    phone: text().notNull(),
    reason: text(),
    createdBy: userRef(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sms_opt_out_phone").on(t.organizationId, t.phone)],
);
