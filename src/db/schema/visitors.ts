import {
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { visitorStatuses } from "../../lib/visitors";

import { createdAt, id, instant, organizationId, userRef } from "./_columns";
import { unit } from "./inventory";
import { residence, resident } from "./residences";

export const visitorStatus = pgEnum("visitor_status", visitorStatuses);

/**
 * A visitor of a residence: announced by a resident from the portal (a day, a code to give at
 * the gate) or logged by staff when they come unannounced; their arrival is recorded. Kept as
 * the register (no deletion); the visitor's name and note are erased after the organization's
 * retention period (Loi 18-07).
 */
export const visitorPass = pgTable(
  "visitor_pass",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    unitId: uuid(),
    /** The resident who announced the visitor; null when staff log one. */
    residentId: uuid(),
    hostName: text().notNull(),
    visitorName: text().notNull(),
    people: integer().notNull().default(1),
    expectedOn: date({ mode: "string" }).notNull(),
    /** The code given at the gate (announced visitors only). */
    code: text(),
    note: text(),
    status: visitorStatus().notNull().default("expected"),
    arrivedAt: instant(),
    recordedBy: userRef(),
    cancelledAt: instant(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    /** The visitor's name and note erased (retention period). */
    erasedAt: instant(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "visitor_pass_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "visitor_pass_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    foreignKey({
      name: "visitor_pass_resident_fk",
      columns: [t.organizationId, t.residentId],
      foreignColumns: [resident.organizationId, resident.id],
    }),
    index().on(t.organizationId, t.residenceId, t.expectedOn),
  ],
);
