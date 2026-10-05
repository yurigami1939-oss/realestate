import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import {
  type WhatsappKind,
  whatsappKinds,
  whatsappLanguages,
  whatsappStatuses,
} from "../../lib/whatsapp";

import { createdAt, id, instant, organizationId, updatedAt, userRef } from "./_columns";

export const whatsappLanguage = pgEnum("whatsapp_language", whatsappLanguages);
export const whatsappKind = pgEnum("whatsapp_kind", whatsappKinds);
export const whatsappStatus = pgEnum("whatsapp_status", whatsappStatuses);

/** Per notification: sent or not, and the approved template's name (its default otherwise). */
export type WhatsappNotificationSettings = Partial<
  Record<WhatsappKind, { enabled: boolean; template: string }>
>;

/**
 * The organization's WhatsApp Business number (Cloud API): messages come from the promoter's
 * own number. The access token and the app secret are encrypted (src/server/secrets.ts).
 */
export const whatsappAccount = pgTable("whatsapp_account", {
  organizationId: organizationId().primaryKey(),
  enabled: boolean().notNull().default(false),
  /** Meta's ids of the sending number and of the WhatsApp Business account. */
  phoneNumberId: text().notNull(),
  businessAccountId: text(),
  accessTokenEncrypted: text().notNull(),
  /** Signs the webhook calls (delivery statuses, « STOP » replies). */
  appSecretEncrypted: text(),
  /** Answered to Meta when the webhook is set up (`hub.verify_token`). */
  verifyToken: text().notNull(),
  language: whatsappLanguage().notNull().default("fr"),
  notifications: jsonb()
    .$type<WhatsappNotificationSettings>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: updatedAt(),
  updatedBy: userRef(),
});

/**
 * One template message to one person (CLAUDE.md §7 WhatsApp), queued in the transaction of the
 * event it reports and sent by the worker; its status follows Meta's webhook. Never deleted.
 */
export const whatsappMessage = pgTable(
  "whatsapp_message",
  {
    id: id(),
    organizationId: organizationId(),
    kind: whatsappKind().notNull(),
    /** `wa_id`: international number without « + ». */
    recipient: text().notNull(),
    recipientName: text().notNull(),
    template: text().notNull(),
    language: whatsappLanguage().notNull(),
    params: jsonb().$type<string[]>().notNull(),
    /** The record it is about (sale, residence, lease), for the log's link. */
    refType: text().notNull(),
    refId: uuid().notNull(),
    status: whatsappStatus().notNull().default("queued"),
    /** Meta's message id (`wamid…`) once accepted. */
    wamid: text(),
    error: text(),
    sentAt: instant(),
    deliveredAt: instant(),
    readAt: instant(),
    failedAt: instant(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    index().on(t.organizationId, t.createdAt),
    index().on(t.organizationId, t.wamid),
  ],
);
