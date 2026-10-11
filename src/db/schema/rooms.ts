import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { bookingStatuses } from "../../lib/rooms";

import { createdAt, id, instant, organizationId, timestamps, userRef } from "./_columns";
import { residence, resident } from "./residences";

export const roomBookingStatus = pgEnum("room_booking_status", bookingStatuses);

/**
 * A common room of a residence residents may book (salle polyvalente, terrain, barbecue…):
 * its opening hours (Algiers "HH:MM"), the longest booking, whether the gestionnaire approves
 * each booking. Archived, never deleted.
 */
export const commonRoom = pgTable(
  "common_room",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    capacity: integer(),
    opensAt: text().notNull(),
    closesAt: text().notNull(),
    maxHours: integer().notNull(),
    needsApproval: boolean().notNull().default(true),
    archivedAt: instant(),
    ...timestamps(),
    createdBy: userRef().notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "common_room_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    index().on(t.organizationId, t.residenceId),
    check("common_room_hours", sql`${t.opensAt} < ${t.closesAt}`),
    check("common_room_max_hours", sql`${t.maxHours} between 1 and 24`),
  ],
);

/**
 * A booking of a common room: for a resident (from the portal) or by staff; requested, then
 * approved or rejected (with a note), or cancelled. Kept as the room's history (no deletion).
 */
export const roomBooking = pgTable(
  "room_booking",
  {
    id: id(),
    organizationId: organizationId(),
    roomId: uuid().notNull(),
    residenceId: uuid().notNull(),
    /** The resident booking (from the portal); null when staff book. */
    residentId: uuid(),
    /** Who the room is booked for, as shown to staff. */
    bookedFor: text().notNull(),
    startsAt: instant().notNull(),
    endsAt: instant().notNull(),
    purpose: text().notNull(),
    guests: integer(),
    status: roomBookingStatus().notNull().default("requested"),
    requestedBy: userRef().notNull(),
    createdAt: createdAt(),
    decidedBy: userRef(),
    decidedAt: instant(),
    decisionNote: text(),
    cancelledBy: userRef(),
    cancelledAt: instant(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "room_booking_room_fk",
      columns: [t.organizationId, t.roomId],
      foreignColumns: [commonRoom.organizationId, commonRoom.id],
    }),
    foreignKey({
      name: "room_booking_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "room_booking_resident_fk",
      columns: [t.organizationId, t.residentId],
      foreignColumns: [resident.organizationId, resident.id],
    }),
    index().on(t.organizationId, t.roomId, t.startsAt),
    check("room_booking_period", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
