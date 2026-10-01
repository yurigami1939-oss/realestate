import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
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
  commissionStatuses,
  constructionStages,
  optionStatuses,
  paymentMethods,
  reservationStatuses,
  type VspLimits,
} from "../../lib/sales";

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
import { buyer } from "./buyers";
import { lead } from "./crm";
import { file } from "./files";
import { project, unit } from "./inventory";

export const planStepTrigger = pgEnum("plan_step_trigger", planStepTriggers);
export const constructionStage = pgEnum("construction_stage", constructionStages);
export const optionStatus = pgEnum("option_status", optionStatuses);
export const quotationStatus = pgEnum("quotation_status", ["issued", "cancelled"]);

/**
 * Company-level settings of the promoter (one row per organization, created on first save).
 * Rates are basis points. Defaults: `salesSettingDefaults` (src/lib/sales.ts, CLAUDE.md §12).
 */
export const organizationSetting = pgTable(
  "organization_setting",
  {
    organizationId: organizationId().primaryKey(),
    /** Printed on quotations: valid N days from issue. */
    quotationValidityDays: integer().notNull().default(15),
    /** An option holds a unit this long, then the unit is released. */
    optionHours: integer().notNull().default(24),
    /** A milestone payment call is due N days after the milestone is validated. */
    paymentCallDelayDays: integer().notNull().default(15),
    /** Share of the amount paid kept on withdrawal (proposed, editable per case). */
    withdrawalRetentionBp: integer().notNull().default(1000),
    /** Late-payment penalty per month of delay on the overdue amount; 0 = off. */
    penaltyMonthlyRateBp: integer().notNull().default(0),
    penaltyGraceDays: integer().notNull().default(0),
    /** Penalty cap, as a share of the installment. */
    penaltyCapBp: integer().notNull().default(1000),
    /** Commission on the net price, earned at the VSP; overridable per commercial. */
    defaultCommissionRateBp: integer().notNull().default(0),
    /** Cumulative VSP payment limits per stage (warnings only); empty = no check. */
    vspLimits: jsonb()
      .$type<VspLimits>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: updatedAt(),
    updatedBy: userRef(),
  },
  (t) => [
    check("organization_setting_validity_range", sql`${t.quotationValidityDays} between 1 and 365`),
    check("organization_setting_option_hours", sql`${t.optionHours} between 1 and 720`),
    check("organization_setting_call_delay", sql`${t.paymentCallDelayDays} between 0 and 180`),
    check(
      "organization_setting_rates",
      sql`${t.withdrawalRetentionBp} between 0 and 10000
        and ${t.penaltyMonthlyRateBp} between 0 and 1000
        and ${t.penaltyGraceDays} between 0 and 365
        and ${t.penaltyCapBp} between 0 and 10000
        and ${t.defaultCommissionRateBp} between 0 and 2000`,
    ),
  ],
);

/**
 * Étape d'avancement des travaux: planned (name, date) for payment plans; validating it makes the
 * linked installments due and issues the payment calls. `stage` classifies it for VSP limits.
 */
export const constructionMilestone = pgTable(
  "construction_milestone",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    position: integer().notNull(),
    name: text().notNull(),
    stage: constructionStage(),
    plannedOn: date({ mode: "string" }),
    validatedOn: date({ mode: "string" }),
    validatedBy: userRef(),
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

/**
 * Option: a unit held for a lead until `expiresAt` (unit status `optioned`). At most one active
 * option per unit; only that lead can reserve it. A job ends it at expiry.
 */
export const unitOption = pgTable(
  "unit_option",
  {
    id: id(),
    organizationId: organizationId(),
    unitId: uuid().notNull(),
    leadId: uuid().notNull(),
    placedBy: userRef().notNull(),
    placedAt: instant().notNull().defaultNow(),
    expiresAt: instant().notNull(),
    status: optionStatus().notNull().default("active"),
    endedAt: instant(),
    endedBy: userRef(),
    endReason: text(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "unit_option_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    foreignKey({
      name: "unit_option_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }),
    uniqueIndex("unit_option_one_active")
      .on(t.organizationId, t.unitId)
      .where(sql`${t.status} = 'active'`),
    index().on(t.organizationId, t.leadId),
    check("unit_option_expiry", sql`${t.expiresAt} > ${t.placedAt}`),
  ],
);

export const reservationStatus = pgEnum("reservation_status", reservationStatuses);
export const commissionStatus = pgEnum("commission_status", commissionStatuses);

/**
 * Réservation, then vente (VSP) once signed at the notary. Numbered RES-…; the VSP gets its
 * own VSP-… reference. Prices are snapshots: later price lists never touch them. At most one
 * live (reserved or sold) reservation per unit.
 */
export const reservation = pgTable(
  "reservation",
  {
    id: id(),
    organizationId: organizationId(),
    number: text().notNull(),
    unitId: uuid().notNull(),
    projectId: uuid().notNull(),
    leadId: uuid(),
    /** Commercial credited with the sale (lead owner at reservation): commissions, targets. */
    commercialUserId: userRef(),
    paymentPlanId: uuid(),
    listPrice: money().notNull(),
    discount: money()
      .notNull()
      .default(sql`0`),
    price: money().notNull(),
    status: reservationStatus().notNull().default("reserved"),
    /** Contrat de réservation (signed at the notary). */
    reservedOn: date({ mode: "string" }).notNull(),
    reservationNotary: text(),
    reservationReference: text(),
    reservationScanFileId: uuid(),
    /** Vente sur plans (acte notarié). */
    saleNumber: text(),
    saleSignedOn: date({ mode: "string" }),
    saleNotary: text(),
    saleReference: text(),
    saleScanFileId: uuid(),
    /** Internal reservation sheet (PDF rendered by the worker). */
    sheetFileId: uuid(),
    notes: text(),
    endedOn: date({ mode: "string" }),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    unique().on(t.organizationId, t.saleNumber),
    foreignKey({
      name: "reservation_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    foreignKey({
      name: "reservation_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    foreignKey({
      name: "reservation_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }),
    foreignKey({
      name: "reservation_plan_fk",
      columns: [t.organizationId, t.paymentPlanId],
      foreignColumns: [paymentPlan.organizationId, paymentPlan.id],
    }),
    foreignKey({
      name: "reservation_scan_fk",
      columns: [t.organizationId, t.reservationScanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    foreignKey({
      name: "reservation_deed_fk",
      columns: [t.organizationId, t.saleScanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    foreignKey({
      name: "reservation_sheet_fk",
      columns: [t.organizationId, t.sheetFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    uniqueIndex("reservation_one_live_per_unit")
      .on(t.organizationId, t.unitId)
      .where(sql`${t.status} in ('reserved', 'sold')`),
    index().on(t.organizationId, t.commercialUserId),
    index().on(t.organizationId, t.leadId),
    check(
      "reservation_amounts",
      sql`${t.discount} >= 0 and ${t.price} = ${t.listPrice} - ${t.discount}`,
    ),
    check(
      "reservation_sale",
      sql`(${t.status} = 'sold') <= (${t.saleSignedOn} is not null and ${t.saleNumber} is not null)`,
    ),
  ],
);

/** Buyers of a reservation (co-acquéreurs); position 1 is the main buyer. */
export const reservationBuyer = pgTable(
  "reservation_buyer",
  {
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    buyerId: uuid().notNull(),
    position: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reservationId, t.buyerId] }),
    unique("reservation_buyer_position").on(t.reservationId, t.position),
    foreignKey({
      name: "reservation_buyer_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reservation_buyer_buyer_fk",
      columns: [t.organizationId, t.buyerId],
      foreignColumns: [buyer.organizationId, buyer.id],
    }),
    index().on(t.organizationId, t.buyerId),
  ],
);

/**
 * Échéance of a sale. Amounts sum exactly to the price (allocate). A milestone installment has
 * no due date until its milestone is validated (then validation day + company delay).
 */
export const installment = pgTable(
  "installment",
  {
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    position: integer().notNull(),
    label: text().notNull(),
    shareBp: integer().notNull(),
    amount: money().notNull(),
    trigger: planStepTrigger().notNull(),
    months: integer(),
    milestoneId: uuid(),
    dueOn: date({ mode: "string" }),
  },
  (t) => [
    primaryKey({ columns: [t.reservationId, t.position] }),
    foreignKey({
      name: "installment_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "installment_milestone_fk",
      columns: [t.organizationId, t.milestoneId],
      foreignColumns: [constructionMilestone.organizationId, constructionMilestone.id],
    }),
    index().on(t.organizationId, t.milestoneId),
    check("installment_amount", sql`${t.amount} >= 0`),
  ],
);

/** Commission rate of a commercial (overrides the company default). */
export const commissionRate = pgTable(
  "commission_rate",
  {
    organizationId: organizationId(),
    userId: userRef().notNull(),
    rateBp: integer().notNull(),
    updatedAt: updatedAt(),
    updatedBy: userRef(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    check("commission_rate_range", sql`${t.rateBp} between 0 and 2000`),
  ],
);

/** Commission earned at the VSP on the net price (CLAUDE.md §12); one per sale. */
export const commission = pgTable(
  "commission",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    userId: userRef().notNull(),
    base: money().notNull(),
    rateBp: integer().notNull(),
    amount: money().notNull(),
    earnedOn: date({ mode: "string" }).notNull(),
    status: commissionStatus().notNull().default("earned"),
    paidOn: date({ mode: "string" }),
    paidBy: userRef(),
    cancelledAt: instant(),
    cancelledBy: userRef(),
    cancelReason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.reservationId),
    foreignKey({
      name: "commission_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    index().on(t.organizationId, t.userId, t.earnedOn),
  ],
);

export const paymentMethod = pgEnum("payment_method", paymentMethods);
export const paymentStatus = pgEnum("payment_status", ["valid", "cancelled"]);
export const receiptStatus = pgEnum("receipt_status", ["issued", "cancelled"]);

/**
 * Encaissement on a sale. Immutable (CLAUDE.md §7): only its cancellation (with a reason) and a
 * cheque's clearance date can change — enforced by column grants in post-migrate.sql. Applied to
 * installments by the derived FIFO statement (src/lib/statement.ts), never stored.
 */
export const payment = pgTable(
  "payment",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    amount: money().notNull(),
    method: paymentMethod().notNull(),
    /** Day the money (or cheque) was received. */
    paidOn: date({ mode: "string" }).notNull(),
    /** Cheque number, transfer reference… */
    reference: text(),
    bank: text(),
    /** Who handed the payment over, as printed on the receipt. */
    payerName: text().notNull(),
    chequeClearedOn: date({ mode: "string" }),
    notes: text(),
    status: paymentStatus().notNull().default("valid"),
    cancelledAt: instant(),
    cancelledBy: userRef(),
    cancellationReason: text(),
    recordedBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "payment_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    index().on(t.organizationId, t.reservationId),
    index().on(t.organizationId, t.paidOn),
    check("payment_amount", sql`${t.amount} > 0`),
    check(
      "payment_cancellation",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancellationReason} is not null)`,
    ),
  ],
);

/**
 * Reçu REC-…: exactly one per payment, issued with it. `allocation` is the snapshot of the
 * installments the payment settled when it was issued (printed on the receipt).
 */
export const receipt = pgTable(
  "receipt",
  {
    id: id(),
    organizationId: organizationId(),
    number: text().notNull(),
    paymentId: uuid().notNull(),
    issuedAt: instant().notNull().defaultNow(),
    issuedBy: userRef().notNull(),
    allocation: jsonb()
      .$type<{ position: number; label: string; amount: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: receiptStatus().notNull().default("issued"),
    cancelledAt: instant(),
    pdfFileId: uuid(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    unique().on(t.organizationId, t.paymentId),
    foreignKey({
      name: "receipt_payment_fk",
      columns: [t.organizationId, t.paymentId],
      foreignColumns: [payment.organizationId, payment.id],
    }),
    foreignKey({
      name: "receipt_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
  ],
);

/**
 * Appel de fonds (ADF-…): issued per sale for each installment of a validated milestone,
 * once (idempotent issue job). Snapshots what was called; the statement stays derived.
 */
export const paymentCall = pgTable(
  "payment_call",
  {
    id: id(),
    organizationId: organizationId(),
    number: text().notNull(),
    reservationId: uuid().notNull(),
    milestoneId: uuid().notNull(),
    installmentPosition: integer().notNull(),
    label: text().notNull(),
    /** The installment's amount, what earlier payments already settled on it, and the rest. */
    amount: money().notNull(),
    settled: money().notNull(),
    called: money().notNull(),
    dueOn: date({ mode: "string" }).notNull(),
    issuedAt: instant().notNull().defaultNow(),
    pdfFileId: uuid(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    unique("payment_call_installment_key").on(
      t.organizationId,
      t.reservationId,
      t.installmentPosition,
    ),
    foreignKey({
      name: "payment_call_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    foreignKey({
      name: "payment_call_milestone_fk",
      columns: [t.organizationId, t.milestoneId],
      foreignColumns: [constructionMilestone.organizationId, constructionMilestone.id],
    }),
    foreignKey({
      name: "payment_call_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.milestoneId),
    check(
      "payment_call_amounts",
      sql`${t.settled} >= 0 and ${t.called} > 0 and ${t.settled} + ${t.called} = ${t.amount}`,
    ),
  ],
);
