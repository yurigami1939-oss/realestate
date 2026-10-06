import { sql } from "drizzle-orm";
import {
  check,
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

import { checkCategories, checkKinds, checkResults } from "../../lib/maintenance";

import { createdAt, id, instant, money, organizationId, timestamps, userRef } from "./_columns";
import { file } from "./files";
import { residence } from "./residences";
import { supplier } from "./suppliers";

export const checkKind = pgEnum("check_kind", checkKinds);
export const checkCategory = pgEnum("check_category", checkCategories);
export const checkResult = pgEnum("check_result", checkResults);

/**
 * A deadline a residence must keep (CLAUDE.md §7 Residence charges): its insurance policy, a
 * regulatory inspection (lifts, extinguishers…) or preventive maintenance, with its frequency
 * and next due day. Archived, never deleted.
 */
export const residenceCheck = pgTable(
  "residence_check",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    kind: checkKind().notNull(),
    category: checkCategory().notNull(),
    title: text().notNull(),
    supplierId: uuid(),
    /** Months between two visits; null for a one-off deadline. */
    frequencyMonths: integer(),
    nextDueOn: date({ mode: "string" }).notNull(),
    /** Policy or contract number. */
    reference: text(),
    notes: text(),
    archivedAt: instant(),
    ...timestamps(),
    createdBy: userRef().notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "residence_check_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "residence_check_supplier_fk",
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [supplier.organizationId, supplier.id],
    }),
    index().on(t.organizationId, t.residenceId, t.nextDueOn),
    check(
      "residence_check_frequency",
      sql`${t.frequencyMonths} is null or ${t.frequencyMonths} between 1 and 120`,
    ),
  ],
);

/**
 * A visit recorded on a check (done on a day, by a supplier, its outcome and cost, the
 * certificate's scan): append-only but for the scan.
 */
export const residenceCheckVisit = pgTable(
  "residence_check_visit",
  {
    id: id(),
    organizationId: organizationId(),
    checkId: uuid().notNull(),
    doneOn: date({ mode: "string" }).notNull(),
    supplierId: uuid(),
    result: checkResult().notNull(),
    notes: text(),
    cost: money(),
    /** The deadline the visit set for the next one. */
    nextDueOn: date({ mode: "string" }).notNull(),
    scanFileId: uuid(),
    recordedBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "residence_check_visit_check_fk",
      columns: [t.organizationId, t.checkId],
      foreignColumns: [residenceCheck.organizationId, residenceCheck.id],
    }),
    foreignKey({
      name: "residence_check_visit_supplier_fk",
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [supplier.organizationId, supplier.id],
    }),
    foreignKey({
      name: "residence_check_visit_scan_fk",
      columns: [t.organizationId, t.scanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.checkId, t.doneOn),
    check("residence_check_visit_cost", sql`${t.cost} is null or ${t.cost} >= 0`),
  ],
);
