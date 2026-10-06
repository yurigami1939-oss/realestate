import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  portalRequestKinds,
  portalRequestStatuses,
  requestableCertificates,
} from "../../lib/requests";

import { invitation } from "./auth";
import { createdAt, id, instant, organizationId, timestamps, userRef } from "./_columns";
import { buyer } from "./buyers";
import { resident } from "./residences";
import { reservation } from "./sales";

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

export const portalRequestKind = pgEnum("portal_request_kind", portalRequestKinds);
export const portalRequestStatus = pgEnum("portal_request_status", portalRequestStatuses);
export const requestableCertificate = pgEnum("requestable_certificate", requestableCertificates);

/**
 * A request a buyer sends from the portal about one of their sales (CLAUDE.md §7 Portal): an
 * attestation, an appointment or anything else; staff close it, done or declined, with an
 * answer the buyer reads.
 */
export const portalRequest = pgTable(
  "portal_request",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    /** The portal account that sent it. */
    userId: userRef().notNull(),
    kind: portalRequestKind().notNull(),
    certificateKind: requestableCertificate(),
    /** Day the buyer would like to come (appointments). */
    preferredOn: date({ mode: "string" }),
    message: text(),
    status: portalRequestStatus().notNull().default("open"),
    answer: text(),
    handledBy: userRef(),
    handledAt: instant(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "portal_request_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    index().on(t.organizationId, t.status),
    index().on(t.organizationId, t.reservationId),
    check(
      "portal_request_certificate",
      sql`(${t.kind} = 'certificate') = (${t.certificateKind} is not null)`,
    ),
  ],
);
