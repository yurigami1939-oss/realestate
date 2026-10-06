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

import { discountRequestStatuses } from "../../lib/discounts";
import { planStepTriggers } from "../../lib/payment-plans";
import {
  bankLoanStatuses,
  commissionStatuses,
  constructionStages,
  optionStatuses,
  paymentMethods,
  reminderKinds,
  reservationStatuses,
  type VspLimits,
  withdrawalKinds,
  withdrawalStatuses,
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
import { lead, partner } from "./crm";
import { file } from "./files";
import { project, unit } from "./inventory";
import { treasuryAccount } from "./treasury";

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
    /**
     * Indemnity for late delivery owed to buyers (Loi 11-04 contracts): per month of delay on
     * the price, capped; shown only, never booked; 0 = off.
     */
    deliveryPenaltyMonthlyRateBp: integer().notNull().default(0),
    deliveryPenaltyCapBp: integer().notNull().default(1000),
    /** Termination for non-payment (contracts, Loi 11-04): the delay a formal notice gives,
     * the notices left unanswered before terminating, the retention proposed. */
    formalNoticeDays: integer().notNull().default(15),
    formalNoticesRequired: integer().notNull().default(2),
    terminationRetentionBp: integer().notNull().default(1000),
    /** The promoter's FGCMPI membership number (n° d'adhésion). */
    fgcmpiNumber: text(),
    /** Company logo (PNG/JPEG), printed on the documents issued afterwards. */
    logoFileId: uuid(),
    updatedAt: updatedAt(),
    updatedBy: userRef(),
  },
  (t) => [
    foreignKey({
      name: "organization_setting_logo_fk",
      columns: [t.organizationId, t.logoFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
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
    check(
      "organization_setting_delivery_penalty",
      sql`${t.deliveryPenaltyMonthlyRateBp} between 0 and 1000
        and ${t.deliveryPenaltyCapBp} between 0 and 10000`,
    ),
    check(
      "organization_setting_termination",
      sql`${t.formalNoticeDays} between 1 and 90
        and ${t.formalNoticesRequired} between 1 and 5
        and ${t.terminationRetentionBp} between 0 and 10000`,
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

export const discountRequestStatus = pgEnum("discount_request_status", discountRequestStatuses);

/**
 * A commercial asks a manager for a discount on a unit for one of their leads (CLAUDE.md §7).
 * Approved (possibly for less), it may be granted on that lead's quotations and reservation of
 * the unit up to `approved_amount` until `valid_until`; one pending request per lead and unit.
 */
export const discountRequest = pgTable(
  "discount_request",
  {
    id: id(),
    organizationId: organizationId(),
    leadId: uuid().notNull(),
    unitId: uuid().notNull(),
    /** Discount asked for, on the unit's list price at the time. */
    amount: money().notNull(),
    listPrice: money().notNull(),
    reason: text().notNull(),
    status: discountRequestStatus().notNull().default("pending"),
    requestedBy: userRef().notNull(),
    requestedAt: instant().notNull().defaultNow(),
    decidedBy: userRef(),
    decidedAt: instant(),
    approvedAmount: money(),
    validUntil: date({ mode: "string" }),
    decisionNote: text(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "discount_request_lead_fk",
      columns: [t.organizationId, t.leadId],
      foreignColumns: [lead.organizationId, lead.id],
    }),
    foreignKey({
      name: "discount_request_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    uniqueIndex("discount_request_one_pending")
      .on(t.organizationId, t.leadId, t.unitId)
      .where(sql`${t.status} = 'pending'`),
    index().on(t.organizationId, t.status),
    check(
      "discount_request_amounts",
      sql`${t.amount} > 0 and ${t.amount} <= ${t.listPrice}
        and (${t.approvedAmount} is null or (${t.approvedAmount} > 0 and ${t.approvedAmount} <= ${t.amount}))`,
    ),
    check(
      "discount_request_approval",
      sql`(${t.status} = 'approved') = (${t.approvedAmount} is not null and ${t.validUntil} is not null)`,
    ),
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
    /**
     * Contractual delivery date (Loi 11-04): the project's planned delivery at reservation,
     * corrected from the contract; past it, the indemnity owed to the buyer is shown.
     */
    deliveryDueOn: date({ mode: "string" }),
    /** FGCMPI guarantee certificate annexed to the VSP: number, date, scan. */
    guaranteeNumber: text(),
    guaranteeIssuedOn: date({ mode: "string" }),
    /** The FGCMPI premium paid for that guarantee. */
    guaranteePremium: money(),
    guaranteeScanFileId: uuid(),
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
      name: "reservation_guarantee_fk",
      columns: [t.organizationId, t.guaranteeScanFileId],
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

/** One line of a schedule as an amendment printed it (amounts as decimal strings of centimes). */
export type AmendmentLine = {
  label: string;
  amount: string;
  dueOn: string | null;
  milestoneName: string | null;
};

/**
 * Avenant: the unpaid part of a sale's schedule replaced by new lines (CLAUDE.md §7). Keeps
 * the lines replaced and the new ones as printed; immutable except its PDF link.
 */
export const scheduleAmendment = pgTable(
  "schedule_amendment",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    /** Avenant n° 1, 2… per sale. */
    sequence: integer().notNull(),
    signedOn: date({ mode: "string" }).notNull(),
    reason: text().notNull(),
    /** Valid payments of the sale on the day of the amendment. */
    paid: money().notNull(),
    replaced: jsonb().$type<AmendmentLine[]>().notNull(),
    lines: jsonb().$type<AmendmentLine[]>().notNull(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    pdfFileId: uuid(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("schedule_amendment_sequence_key").on(t.organizationId, t.reservationId, t.sequence),
    foreignKey({
      name: "schedule_amendment_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    foreignKey({
      name: "schedule_amendment_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
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
    /** Brought in by a data import: receipted by the previous system, so no REC- receipt here. */
    imported: boolean().notNull().default(false),
    /** That system's receipt number, when known. */
    legacyReceipt: text(),
    /** The cash desk or account the money landed on (CLAUDE.md §7 Treasury). */
    accountId: uuid(),
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
    foreignKey({
      name: "payment_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    index().on(t.organizationId, t.accountId),
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

/**
 * Lettre de relance: issued on demand for a sale with overdue installments. Keeps the
 * overdue lines it printed (amounts as decimal strings of centimes); its PDF is rendered once.
 */
export const reminderKind = pgEnum("reminder_kind", reminderKinds);

export const reminderLetter = pgTable(
  "reminder_letter",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    /** A reminder, or a formal notice (mise en demeure) on the way to a termination. */
    kind: reminderKind().notNull().default("reminder"),
    issuedAt: instant().notNull().defaultNow(),
    issuedBy: userRef().notNull(),
    overdue: money().notNull(),
    penalties: money().notNull(),
    lines: jsonb()
      .$type<
        {
          position: number;
          label: string;
          dueOn: string;
          remaining: string;
          daysLate: number;
          penalty: string;
        }[]
      >()
      .notNull(),
    /** Date by which the buyer is asked to settle. */
    payBy: date({ mode: "string" }).notNull(),
    pdfFileId: uuid(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "reminder_letter_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    foreignKey({
      name: "reminder_letter_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.reservationId),
    check("reminder_letter_amounts", sql`${t.overdue} > 0 and ${t.penalties} >= 0`),
  ],
);

// ── After the reservation: withdrawal, transfer, unit swap, bank loan ──────

export const withdrawalStatus = pgEnum("withdrawal_status", withdrawalStatuses);

/**
 * Désistement (CLAUDE.md §12): proposed by the directeur commercial with a retention on the
 * amount paid, approved (or rejected) by the gérant; the refund is recorded when paid out.
 * Amounts are computed at the proposal and final at the approval.
 */
export const withdrawalKind = pgEnum("withdrawal_kind", withdrawalKinds);

export const withdrawal = pgTable(
  "withdrawal",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    /** The buyer's désistement, or the promoter's termination for non-payment. */
    kind: withdrawalKind().notNull().default("withdrawal"),
    status: withdrawalStatus().notNull().default("proposed"),
    reason: text().notNull(),
    retentionBp: integer().notNull(),
    paid: money().notNull(),
    retention: money().notNull(),
    refund: money().notNull(),
    proposedBy: userRef().notNull(),
    proposedAt: instant().notNull().defaultNow(),
    decidedBy: userRef(),
    decidedAt: instant(),
    decisionNote: text(),
    refundedOn: date({ mode: "string" }),
    refundMethod: paymentMethod(),
    refundReference: text(),
    refundRecordedBy: userRef(),
    /** The cash desk or account the refund left from (CLAUDE.md §7 Treasury). */
    refundAccountId: uuid(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "withdrawal_refund_account_fk",
      columns: [t.organizationId, t.refundAccountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    uniqueIndex("withdrawal_open_key")
      .on(t.organizationId, t.reservationId)
      .where(sql`${t.status} <> 'rejected'`),
    foreignKey({
      name: "withdrawal_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    check(
      "withdrawal_amounts",
      sql`${t.retention} >= 0 and ${t.refund} >= 0 and ${t.retention} + ${t.refund} = ${t.paid}`,
    ),
    check("withdrawal_retention_bp", sql`${t.retentionBp} between 0 and 10000`),
  ],
);

/** Cession de réservation: the buyers change, the unit stays reserved (history, append-only). */
export const reservationTransfer = pgTable(
  "reservation_transfer",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    transferredOn: date({ mode: "string" }).notNull(),
    fromBuyerIds: jsonb().$type<string[]>().notNull(),
    toBuyerIds: jsonb().$type<string[]>().notNull(),
    notes: text(),
    recordedBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "reservation_transfer_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    index().on(t.organizationId, t.reservationId),
  ],
);

/** Changement de lot: the sale moves to another unit at a new price (history, append-only). */
export const unitSwap = pgTable(
  "unit_swap",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    fromUnitId: uuid().notNull(),
    toUnitId: uuid().notNull(),
    fromPrice: money().notNull(),
    toPrice: money().notNull(),
    swappedOn: date({ mode: "string" }).notNull(),
    reason: text().notNull(),
    recordedBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "unit_swap_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    foreignKey({
      name: "unit_swap_from_unit_fk",
      columns: [t.organizationId, t.fromUnitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    foreignKey({
      name: "unit_swap_to_unit_fk",
      columns: [t.organizationId, t.toUnitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    index().on(t.organizationId, t.reservationId),
  ],
);

export const bankLoanStatus = pgEnum("bank_loan_status", bankLoanStatuses);

/**
 * Crédit bancaire of a buyer (dossier → accord → déblocage). Disbursements are payments of
 * the sale with the `bank_loan` method.
 */
export const bankLoan = pgTable(
  "bank_loan",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    bank: text().notNull(),
    requested: money().notNull(),
    approved: money(),
    status: bankLoanStatus().notNull().default("preparing"),
    submittedOn: date({ mode: "string" }),
    decidedOn: date({ mode: "string" }),
    reference: text(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    uniqueIndex("bank_loan_open_key")
      .on(t.organizationId, t.reservationId)
      .where(sql`${t.status} not in ('refused', 'cancelled')`),
    foreignKey({
      name: "bank_loan_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    check(
      "bank_loan_amounts",
      sql`${t.requested} > 0 and (${t.approved} is null or ${t.approved} > 0)`,
    ),
  ],
);

/**
 * Commission of the agency or introducer who brought a sale's lead (CLAUDE.md §7 CRM): earned
 * at the VSP at the partner's rate on the net price, paid from an account, cancelled when the
 * sale is undone.
 */
export const partnerCommission = pgTable(
  "partner_commission",
  {
    id: id(),
    organizationId: organizationId(),
    reservationId: uuid().notNull(),
    partnerId: uuid().notNull(),
    base: money().notNull(),
    rateBp: integer().notNull(),
    amount: money().notNull(),
    earnedOn: date({ mode: "string" }).notNull(),
    status: commissionStatus().notNull().default("earned"),
    paidOn: date({ mode: "string" }),
    paymentMethod: paymentMethod(),
    accountId: uuid(),
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
      name: "partner_commission_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    foreignKey({
      name: "partner_commission_partner_fk",
      columns: [t.organizationId, t.partnerId],
      foreignColumns: [partner.organizationId, partner.id],
    }),
    foreignKey({
      name: "partner_commission_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    index().on(t.organizationId, t.partnerId),
    check("partner_commission_amount", sql`${t.amount} > 0`),
  ],
);
