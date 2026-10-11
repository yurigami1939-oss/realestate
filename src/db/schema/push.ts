import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { Locale } from "@/i18n/locales";

import { user } from "./auth";
import { createdAt, id, instant } from "./_columns";

/**
 * A browser or phone that agreed to receive push notifications for a user (CLAUDE.md §7 Push
 * notifications): its push service endpoint and keys (Web Push), and the language the user had
 * when turning them on (the notifications' language). A device of the user, not tenant data:
 * no `organization_id` (like Better Auth's tables); services always filter on the user and its
 * membership. Deleted when the user turns it off or the push service says it is gone.
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    locale: text().$type<Locale>().notNull(),
    userAgent: text(),
    createdAt: createdAt(),
    lastSentAt: instant(),
  },
  (t) => [
    uniqueIndex("push_subscription_endpoint").on(t.endpoint),
    index().on(t.userId),
    check("push_subscription_locale", sql`${t.locale} in ('fr', 'ar')`),
  ],
);
