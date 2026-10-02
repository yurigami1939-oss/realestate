import { sql } from "drizzle-orm";
import {
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { budgetStatuses, distributionKeys, distributionWeightings } from "../../lib/residences";

import {
  createdAt,
  id,
  instant,
  money,
  organizationId,
  softDelete,
  timestamps,
  userRef,
} from "./_columns";
import { file } from "./files";
import { building } from "./inventory";
import { chargeFrequency, residence, residenceUnit, resident } from "./residences";

export const distributionKey = pgEnum("distribution_key", distributionKeys);
export const distributionWeighting = pgEnum("distribution_weighting", distributionWeightings);
export const budgetStatus = pgEnum("budget_status", budgetStatuses);
export const chargePeriodStatus = pgEnum("charge_period_status", ["issued", "cancelled"]);

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

/**
 * One issue of charge calls: period `period_index` (1…n at the budget's frequency) of an
 * approved budget, one numbered call per unit with something to pay. Immutable once issued:
 * only its cancellation (with a reason, which voids its calls) can change, and the period can
 * then be issued again.
 */
export const chargePeriod = pgTable(
  "charge_period",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    budgetId: uuid().notNull(),
    year: integer().notNull(),
    frequency: chargeFrequency().notNull(),
    periodIndex: integer().notNull(),
    issuedOn: date({ mode: "string" }).notNull(),
    dueOn: date({ mode: "string" }).notNull(),
    /** Sum of the calls, reserve fund included, and the reserve fund part. */
    total: money().notNull(),
    reserve: money().notNull(),
    callCount: integer().notNull(),
    status: chargePeriodStatus().notNull().default("issued"),
    issuedBy: userRef().notNull(),
    issuedAt: createdAt(),
    cancelledAt: instant(),
    cancelledBy: userRef(),
    cancellationReason: text(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("charge_period_residence_key").on(t.organizationId, t.residenceId, t.id),
    foreignKey({
      name: "charge_period_budget_fk",
      columns: [t.organizationId, t.residenceId, t.budgetId],
      foreignColumns: [budget.organizationId, budget.residenceId, budget.id],
    }),
    uniqueIndex("charge_period_live_key")
      .on(t.organizationId, t.budgetId, t.periodIndex)
      .where(sql`${t.status} = 'issued'`),
    check("charge_period_index", sql`${t.periodIndex} between 1 and 12`),
    check("charge_period_dates", sql`${t.dueOn} >= ${t.issuedOn}`),
    check("charge_period_amounts", sql`${t.total} > 0 and ${t.reserve} >= 0`),
    check(
      "charge_period_cancellation",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancellationReason} is not null)`,
    ),
  ],
);

/**
 * Appel de charges ADC-… of one unit for a period, addressed to its main co-owner at issue
 * (snapshot; none = a unit the company still owns). Lines in `charge_call_line`; the PDF is
 * rendered once. Live while its period is issued.
 */
export const chargeCall = pgTable(
  "charge_call",
  {
    id: id(),
    organizationId: organizationId(),
    residenceId: uuid().notNull(),
    periodId: uuid().notNull(),
    unitId: uuid().notNull(),
    number: text().notNull(),
    dueOn: date({ mode: "string" }).notNull(),
    amount: money().notNull(),
    reserve: money().notNull(),
    residentId: uuid(),
    addresseeName: text(),
    addresseeNameAr: text(),
    addresseeAddress: text(),
    pdfFileId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    unique("charge_call_unit_key").on(t.organizationId, t.periodId, t.unitId),
    foreignKey({
      name: "charge_call_period_fk",
      columns: [t.organizationId, t.residenceId, t.periodId],
      foreignColumns: [chargePeriod.organizationId, chargePeriod.residenceId, chargePeriod.id],
    }),
    foreignKey({
      name: "charge_call_unit_fk",
      columns: [t.residenceId, t.unitId],
      foreignColumns: [residenceUnit.residenceId, residenceUnit.unitId],
    }),
    foreignKey({
      name: "charge_call_resident_fk",
      columns: [t.organizationId, t.residentId],
      foreignColumns: [resident.organizationId, resident.id],
    }),
    foreignKey({
      name: "charge_call_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.residenceId, t.unitId),
    check(
      "charge_call_amounts",
      sql`${t.amount} > 0 and ${t.reserve} >= 0 and ${t.reserve} <= ${t.amount}`,
    ),
  ],
);

/** What a call asks for: one line per category the unit bears, then the reserve fund. */
export const chargeCallLine = pgTable(
  "charge_call_line",
  {
    organizationId: organizationId(),
    callId: uuid().notNull(),
    position: integer().notNull(),
    /** Null for the reserve fund line. */
    categoryId: uuid(),
    label: text().notNull(),
    labelAr: text(),
    amount: money().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.callId, t.position] }),
    foreignKey({
      name: "charge_call_line_call_fk",
      columns: [t.organizationId, t.callId],
      foreignColumns: [chargeCall.organizationId, chargeCall.id],
    }),
    foreignKey({
      name: "charge_call_line_category_fk",
      columns: [t.organizationId, t.categoryId],
      foreignColumns: [chargeCategory.organizationId, chargeCategory.id],
    }),
    check("charge_call_line_amount", sql`${t.amount} > 0`),
  ],
);
