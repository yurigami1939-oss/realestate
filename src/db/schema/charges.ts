import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { budgetStatuses, distributionKeys, distributionWeightings } from "../../lib/residences";

import { id, instant, money, organizationId, softDelete, timestamps, userRef } from "./_columns";
import { building } from "./inventory";
import { chargeFrequency, residence, residenceUnit } from "./residences";

export const distributionKey = pgEnum("distribution_key", distributionKeys);
export const distributionWeighting = pgEnum("distribution_weighting", distributionWeightings);
export const budgetStatus = pgEnum("budget_status", budgetStatuses);

/**
 * Catégorie de charges of a residence (water tank, common electricity, lift…) with its
 * distribution key (CLAUDE.md §7 Residence charges). `per_building` names its building;
 * `custom` lists its units in `charge_category_unit`.
 */
export const chargeCategory = pgTable(
  "charge_category",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    name: text().notNull(),
    nameAr: text(),
    key: distributionKey().notNull().default("share"),
    /** Weight of the units for `per_building` and `custom`. */
    weighting: distributionWeighting().notNull().default("share"),
    buildingId: uuid(),
    /** Order on budgets and calls. */
    position: integer().notNull().default(0),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("charge_category_residence_key").on(t.organizationId, t.residenceId, t.id),
    foreignKey({
      name: "charge_category_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "charge_category_building_fk",
      columns: [t.organizationId, t.buildingId],
      foreignColumns: [building.organizationId, building.id],
    }),
    check(
      "charge_category_building",
      sql`(${t.key} = 'per_building') = (${t.buildingId} is not null)`,
    ),
  ],
);

/** Units a `custom` category is split over. */
export const chargeCategoryUnit = pgTable(
  "charge_category_unit",
  {
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    categoryId: uuid().notNull(),
    unitId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId, t.unitId] }),
    foreignKey({
      name: "charge_category_unit_category_fk",
      columns: [t.organizationId, t.residenceId, t.categoryId],
      foreignColumns: [
        chargeCategory.organizationId,
        chargeCategory.residenceId,
        chargeCategory.id,
      ],
    }),
    foreignKey({
      name: "charge_category_unit_unit_fk",
      columns: [t.residenceId, t.unitId],
      foreignColumns: [residenceUnit.residenceId, residenceUnit.unitId],
    }),
  ],
);

/**
 * Budget prévisionnel of a residence for a calendar year: one amount per category. Approved
 * budgets are read-only and freeze the call frequency and reserve fund rate they are called at.
 */
export const budget = pgTable(
  "budget",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    year: integer().notNull(),
    status: budgetStatus().notNull().default("draft"),
    /** Frozen at approval from the residence. */
    frequency: chargeFrequency(),
    reserveFundBp: integer(),
    approvedAt: instant(),
    approvedBy: userRef(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("budget_residence_key").on(t.organizationId, t.residenceId, t.id),
    unique("budget_year_key").on(t.organizationId, t.residenceId, t.year),
    foreignKey({
      name: "budget_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    check("budget_year", sql`${t.year} between 2000 and 2100`),
    check(
      "budget_approval",
      sql`(${t.status} = 'approved') = (${t.approvedAt} is not null and ${t.frequency} is not null and ${t.reserveFundBp} is not null)`,
    ),
  ],
);

/** Annual amount of one category in a budget. */
export const budgetLine = pgTable(
  "budget_line",
  {
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    budgetId: uuid().notNull(),
    categoryId: uuid().notNull(),
    amount: money().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.budgetId, t.categoryId] }),
    foreignKey({
      name: "budget_line_budget_fk",
      columns: [t.organizationId, t.residenceId, t.budgetId],
      foreignColumns: [budget.organizationId, budget.residenceId, budget.id],
    }),
    foreignKey({
      name: "budget_line_category_fk",
      columns: [t.organizationId, t.residenceId, t.categoryId],
      foreignColumns: [
        chargeCategory.organizationId,
        chargeCategory.residenceId,
        chargeCategory.id,
      ],
    }),
    check("budget_line_amount", sql`${t.amount} >= 0`),
  ],
);
