import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  handoverStatuses,
  type PrintedReserve,
  punchStatuses,
  punchTrades,
} from "../../lib/handovers";

import { id, instant, money, organizationId, timestamps, userRef } from "./_columns";
import { file } from "./files";
import { unit } from "./inventory";
import { reservation } from "./sales";

export const handoverStatus = pgEnum("handover_status", handoverStatuses);
export const punchTrade = pgEnum("punch_trade", punchTrades);
export const punchStatus = pgEnum("punch_status", punchStatuses);

/**
 * Remise des clés of a sold unit (module 4): an appointment and the reserves found at the
 * visit, then the PV signed with the buyer (numbered PVL-…, final), which makes the unit
 * `delivered`. The reserves still open at signing are kept as printed; once every reserve is
 * settled, the PV de levée des réserves closes them. One handover per sale.
 */
export const handover = pgTable(
  "handover",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    unitId: uuid().notNull(),
    status: handoverStatus().notNull().default("scheduled"),
    /** Appointment with the buyer, and what to prepare for it (internal). */
    scheduledAt: instant(),
    notes: text(),
    /** PV de remise des clés. */
    number: text(),
    signedOn: date({ mode: "string" }),
    /** Who received the keys (the buyer or their representative). */
    receivedBy: text(),
    keysCount: integer(),
    electricityMeter: text(),
    gasMeter: text(),
    waterMeter: text(),
    /** What remained to pay on the sale at signing (printed on the PV when not zero). */
    outstanding: money(),
    /** The reserves open at signing, as printed on the PV. */
    reserves: jsonb().$type<PrintedReserve[]>(),
    /** Observations printed on the PV. */
    observations: text(),
    signedBy: userRef(),
    pdfFileId: uuid(),
    /** PV de levée des réserves: every reserve lifted or cancelled. */
    reservesClosedOn: date({ mode: "string" }),
    releaseFileId: uuid(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("handover_reservation_key").on(t.organizationId, t.reservationId),
    unique().on(t.organizationId, t.number),
    foreignKey({
      name: "handover_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    foreignKey({
      name: "handover_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    foreignKey({
      name: "handover_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    foreignKey({
      name: "handover_release_fk",
      columns: [t.organizationId, t.releaseFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.scheduledAt),
    check(
      "handover_signed",
      sql`(${t.status} = 'signed') = (${t.number} is not null and ${t.signedOn} is not null
        and ${t.outstanding} is not null and ${t.reserves} is not null)`,
    ),
    check("handover_keys", sql`${t.keysCount} is null or ${t.keysCount} >= 0`),
    check("handover_outstanding", sql`${t.outstanding} is null or ${t.outstanding} >= 0`),
    check(
      "handover_reserves_closed",
      sql`${t.reservesClosedOn} is null or (${t.status} = 'signed' and ${t.reservesClosedOn} >= ${t.signedOn})`,
    ),
  ],
);

/**
 * Réserve: a defect found at the handover visit or after it (until the reserves are closed).
 * Numbered within its handover; open until lifted (works done) or cancelled with a reason.
 */
export const punchItem = pgTable(
  "punch_item",
  {
    id: id(),
    organizationId: organizationId(),
    handoverId: uuid().notNull(),
    position: integer().notNull(),
    /** Room or place: « Cuisine », « Séjour », « Façade »… */
    location: text().notNull(),
    description: text().notNull(),
    trade: punchTrade().notNull().default("other"),
    /** Day the promoter commits to lift it by. */
    dueOn: date({ mode: "string" }),
    status: punchStatus().notNull().default("open"),
    liftedOn: date({ mode: "string" }),
    liftNote: text(),
    liftedBy: userRef(),
    cancelReason: text(),
    cancelledBy: userRef(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "punch_item_handover_fk",
      columns: [t.organizationId, t.handoverId],
      foreignColumns: [handover.organizationId, handover.id],
    }),
    index().on(t.organizationId, t.handoverId, t.position),
    check("punch_item_position", sql`${t.position} > 0`),
    check("punch_item_lifted", sql`(${t.status} = 'lifted') = (${t.liftedOn} is not null)`),
    check(
      "punch_item_cancelled",
      sql`(${t.status} = 'cancelled') = (${t.cancelReason} is not null)`,
    ),
  ],
);
