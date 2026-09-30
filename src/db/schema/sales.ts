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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { planStepTriggers } from "../../lib/payment-plans";

import {
  createdAt,
  id,
  instant,
  money,
  organizationId,
  softDelete,
  timestamps,
  updatedAt,
  userRef,
} from "./_columns";
import { lead } from "./crm";
import { file } from "./files";
import { project, unit } from "./inventory";

export const planStepTrigger = pgEnum("plan_step_trigger", planStepTriggers);
export const quotationStatus = pgEnum("quotation_status", ["issued", "cancelled"]);

/** Company-level settings of the promoter (one row per organization, created on first save). */
export const organizationSetting = pgTable(
  "organization_setting",
  {
    organizationId: organizationId().primaryKey(),
    /** Printed on quotations: valid N days from issue (CLAUDE.md §12, default 15). */
    quotationValidityDays: integer().notNull().default(15),
    updatedAt: updatedAt(),
    updatedBy: userRef(),
  },
  (t) => [
    check("organization_setting_validity_range", sql`${t.quotationValidityDays} between 1 and 365`),
  ],
);

/**
 * Étape d'avancement des travaux. Module 2 plans them (name, planned date) for payment plans;
 * module 4 validates them (`validatedOn`) and triggers payment calls.
 */
export const constructionMilestone = pgTable(
  "construction_milestone",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    position: integer().notNull(),
    name: text().notNull(),
    plannedOn: date({ mode: "string" }),
    validatedOn: date({ mode: "string" }),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.id),
    foreignKey({
      name: "construction_milestone_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    index().on(t.organizationId, t.projectId, t.position),
  ],
);

/** Échéancier type of a project: how the price is split and when each part is due. */
export const paymentPlan = pgTable(
  "payment_plan",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    name: text().notNull(),
    isDefault: boolean().notNull().default(false),
    notes: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.id),
    foreignKey({
      name: "payment_plan_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    uniqueIndex("payment_plan_one_default")
      .on(t.organizationId, t.projectId)
      .where(sql`${t.isDefault} and ${t.deletedAt} is null`),
  ],
);

/** One step of a plan. Steps are replaced as a whole when the plan is edited. */
export const paymentPlanStep = pgTable(
  "payment_plan_step",
  {
    organizationId: organizationId(),
    planId: uuid().notNull(),
    /** Denormalized so milestones can only come from the plan's project (composite FK). */
    projectId: uuid().notNull(),
    position: integer().notNull(),
    label: text().notNull(),
    shareBp: integer().notNull(),
    trigger: planStepTrigger().notNull(),
    months: integer(),
    milestoneId: uuid(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.position] }),
    foreignKey({
      name: "payment_plan_step_plan_fk",
      columns: [t.organizationId, t.projectId, t.planId],
      foreignColumns: [paymentPlan.organizationId, paymentPlan.projectId, paymentPlan.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "payment_plan_step_milestone_fk",
      columns: [t.organizationId, t.projectId, t.milestoneId],
      foreignColumns: [
        constructionMilestone.organizationId,
        constructionMilestone.projectId,
        constructionMilestone.id,
      ],
    }),
    check("payment_plan_step_share", sql`${t.shareBp} between 1 and 10000`),
    check(
      "payment_plan_step_trigger",
      sql`(${t.trigger} = 'months_after_signing') = (${t.months} is not null)
        and (${t.trigger} = 'milestone') = (${t.milestoneId} is not null)`,
    ),
    check("payment_plan_step_months", sql`${t.months} is null or ${t.months} between 0 and 240`),
  ],
);

/**
 * Devis (numbered DEV-YYYY-NNNNNN). Immutable once issued: prices and lines are snapshots;
 * it can only be cancelled with a reason. The PDF is rendered by the worker.
 */
export const quotation = pgTable(
  "quotation",
  {
    id: id(),
    organizationId: organizationId(),
    number: text().notNull(),
    leadId: uuid().notNull(),
    projectId: uuid().notNull(),
    unitId: uuid().notNull(),
    paymentPlanId: uuid().notNull(),
    /** Unit list price when issued. */
    listPrice: money().notNull(),
    discount: money()
      .notNull()
      .default(sql`0`),
    /** Net price = list price − discount. */
    price: money().notNull(),
    issuedAt: instant().notNull().defaultNow(),
    /** Assumed signing date of the schedule (Algiers day of issue). */
    signingOn: date({ mode: "string" }).notNull(),
    validUntil: date({ mode: "string" }).notNull(),
    issuedBy: userRef().notNull(),
    notes: text(),
    status: quotationStatus().notNull().default("issued"),
    cancelledAt: instant(),
    cancelledBy: userRef(),
    cancellationReason: text(),
    pdfFileId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    foreignKey({
      name: "quotation_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }),
    foreignKey({
      name: "quotation_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    foreignKey({
      name: "quotation_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    foreignKey({
      name: "quotation_payment_plan_fk",
      columns: [t.organizationId, t.projectId, t.paymentPlanId],
      foreignColumns: [paymentPlan.organizationId, paymentPlan.projectId, paymentPlan.id],
    }),
    foreignKey({
      name: "quotation_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.leadId),
    index().on(t.organizationId, t.issuedAt),
    check(
      "quotation_amounts",
      sql`${t.discount} >= 0 and ${t.price} = ${t.listPrice} - ${t.discount}`,
    ),
    check(
      "quotation_cancellation",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancellationReason} is not null)`,
    ),
  ],
);

/** Snapshot of a quotation's schedule (append-only). */
export const quotationLine = pgTable(
  "quotation_line",
  {
    organizationId: organizationId(),
    quotationId: uuid().notNull(),
    position: integer().notNull(),
    label: text().notNull(),
    shareBp: integer().notNull(),
    amount: money().notNull(),
    trigger: planStepTrigger().notNull(),
    dueOn: date({ mode: "string" }),
    milestoneName: text(),
  },
  (t) => [
    primaryKey({ columns: [t.quotationId, t.position] }),
    foreignKey({
      name: "quotation_line_quotation_fk",
      columns: [t.organizationId, t.quotationId],
      foreignColumns: [quotation.organizationId, quotation.id],
    }),
  ],
);
