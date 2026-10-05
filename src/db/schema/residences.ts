import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { chargeFrequencies, residentKinds } from "../../lib/residences";

import { id, organizationId, softDelete, timestamps, userRef } from "./_columns";
import { buyer } from "./buyers";
import { project, unit } from "./inventory";

export const chargeFrequency = pgEnum("charge_frequency", chargeFrequencies);
export const residentKind = pgEnum("resident_kind", residentKinds);

/**
 * Résidence after delivery (module 6), set up on a project of the inventory and run by the
 * promoter's own service (CLAUDE.md §12). Units keep their codes; their tantièmes live in
 * `residence_unit`.
 */
export const residence = pgTable(
  "residence",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    name: text().notNull(),
    address: text(),
    commune: text(),
    wilaya: text(),
    /** Total the units' tantièmes are expressed in (e.g. 10 000). */
    shareBasis: integer().notNull().default(10_000),
    chargeFrequency: chargeFrequency().notNull().default("quarterly"),
    /** Reserve fund: share of the annual budget added to the calls (0 = none). */
    reserveFundBp: integer().notNull().default(0),
    /** Days given to pay a charge call. */
    callDueDays: integer().notNull().default(30),
    /** Gestionnaire in charge (optional). */
    managerUserId: userRef(),
    notes: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "residence_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    index().on(t.organizationId, t.projectId),
    check("residence_share_basis", sql`${t.shareBasis} between 1 and 1000000`),
    check("residence_reserve_fund", sql`${t.reserveFundBp} between 0 and 10000`),
    check("residence_call_due_days", sql`${t.callDueDays} between 0 and 365`),
  ],
);

/** A unit of the residence with its tantièmes (quote-part); a unit is in one residence only. */
export const residenceUnit = pgTable(
  "residence_unit",
  {
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    unitId: uuid().notNull(),
    share: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.residenceId, t.unitId] }),
    unique("residence_unit_unit_key").on(t.organizationId, t.unitId),
    foreignKey({
      name: "residence_unit_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "residence_unit_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    check("residence_unit_share", sql`${t.share} >= 0`),
  ],
);

/**
 * Copropriétaire or occupant of a unit, over a period (`until_on` null = current). Co-owners
 * come from the buyers of sold units or are entered by hand (CLAUDE.md §12); the main one is
 * the billing contact of the unit's charges.
 */
export const resident = pgTable(
  "resident",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    unitId: uuid().notNull(),
    kind: residentKind().notNull(),
    /** Main co-owner of the unit (calls are addressed to them first). */
    isMain: boolean().notNull().default(false),
    lastName: text().notNull(),
    firstName: text().notNull(),
    lastNameAr: text(),
    firstNameAr: text(),
    phone: text(),
    /** Agreed to WhatsApp notifications on `phone` (CLAUDE.md §7 WhatsApp). */
    whatsappOptIn: boolean().notNull().default(false),
    email: text(),
    /** Postal address when the co-owner does not live in the unit. */
    address: text(),
    buyerId: uuid(),
    sinceOn: date({ mode: "string" }),
    untilOn: date({ mode: "string" }),
    notes: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "resident_residence_unit_fk",
      columns: [t.residenceId, t.unitId],
      foreignColumns: [residenceUnit.residenceId, residenceUnit.unitId],
    }),
    foreignKey({
      name: "resident_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "resident_buyer_fk",
      columns: [t.organizationId, t.buyerId],
      foreignColumns: [buyer.organizationId, buyer.id],
    }),
    index().on(t.organizationId, t.residenceId, t.unitId),
    check(
      "resident_period",
      sql`${t.untilOn} is null or ${t.sinceOn} is null or ${t.untilOn} >= ${t.sinceOn}`,
    ),
  ],
);
