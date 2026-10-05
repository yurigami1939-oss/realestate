import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { invitation } from "./auth";
import { id, instant, organizationId, timestamps, userRef } from "./_columns";
import { buyer } from "./buyers";
import { resident } from "./residences";

/**
 * Portal access (module 7, CLAUDE.md §12): a buyer file or a co-owner / occupant record shown
 * to a portal account. Staff invite the record's e-mail; the link waits on that e-mail until
 * the invitation is accepted, then names the account. Withdrawn links are kept (revoked).
 */
export const portalLink = pgTable(
  "portal_link",
  {
    id: id(),
    organizationId: organizationId(),
    /** Lowercased e-mail the invitation went to; the account is matched on it. */
    email: text().notNull(),
    /** The portal account, once the invitation is accepted. */
    userId: userRef(),
    /** Exactly one of the buyer file and the resident record. */
    buyerId: uuid(),
    residentId: uuid(),
    /** Invitation sent for it (none when the person already had a portal account). */
    invitationId: uuid().references(() => invitation.id, { onDelete: "set null" }),
    revokedAt: instant(),
    revokedBy: userRef(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "portal_link_buyer_fk",
      columns: [t.organizationId, t.buyerId],
      foreignColumns: [buyer.organizationId, buyer.id],
    }),
    foreignKey({
      name: "portal_link_resident_fk",
      columns: [t.organizationId, t.residentId],
      foreignColumns: [resident.organizationId, resident.id],
    }),
    check("portal_link_target", sql`(${t.buyerId} is null) <> (${t.residentId} is null)`),
    // One live access per record.
    uniqueIndex("portal_link_buyer_key")
      .on(t.organizationId, t.buyerId)
      .where(sql`${t.revokedAt} is null and ${t.buyerId} is not null`),
    uniqueIndex("portal_link_resident_key")
      .on(t.organizationId, t.residentId)
      .where(sql`${t.revokedAt} is null and ${t.residentId} is not null`),
    index().on(t.organizationId, t.userId),
    index().on(t.organizationId, t.email),
  ],
);
