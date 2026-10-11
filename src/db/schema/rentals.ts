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
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { mandateStatuses, ownerStatementStatuses, type StatementExtra } from "../../lib/mandates";
import {
  type InspectionCondition,
  inspectionKinds,
  leaseKinds,
  leaseStatuses,
  rentFrequencies,
  rentPaymentKinds,
} from "../../lib/rentals";

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
import { project, unit } from "./inventory";
import { resident } from "./residences";
import { paymentMethod, paymentStatus } from "./sales";
import { treasuryAccount } from "./treasury";

export const leaseKind = pgEnum("lease_kind", leaseKinds);
export const leaseStatus = pgEnum("lease_status", leaseStatuses);
export const rentFrequency = pgEnum("rent_frequency", rentFrequencies);
export const rentPaymentKind = pgEnum("rent_payment_kind", rentPaymentKinds);
export const mandateStatus = pgEnum("mandate_status", mandateStatuses);
export const ownerStatementStatus = pgEnum("owner_statement_status", ownerStatementStatuses);

/**
 * Propriétaire mandant (CLAUDE.md §7 Rentals): an owner who entrusts the organization with
 * letting units it does not own; its bank details receive the payouts.
 */
export const propertyOwner = pgTable(
  "property_owner",
  {
    id: id(),
    organizationId: organizationId(),
    name: text().notNull(),
    nameAr: text(),
    /** NIN of a person, RC number of a company. */
    idNumber: text(),
    phone: text().notNull(),
    email: text(),
    address: text(),
    bank: text(),
    /** RIB / RIP the payouts are transferred to. */
    rib: text(),
    notes: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [unique().on(t.organizationId, t.id), index().on(t.organizationId, t.name)],
);

/**
 * Mandat de gestion: one owner's unit let by the organization from `start_on`, its fees a rate
 * of the rents collected. One active mandate per unit; ended, never deleted.
 */
export const managementMandate = pgTable(
  "management_mandate",
  {
    id: id(),
    organizationId: organizationId(),
    ownerId: uuid().notNull(),
    unitId: uuid().notNull(),
    signedOn: date({ mode: "string" }).notNull(),
    startOn: date({ mode: "string" }).notNull(),
    /** Management fees, basis points of the rents collected. */
    feeRateBp: integer().notNull(),
    status: mandateStatus().notNull().default("active"),
    endedOn: date({ mode: "string" }),
    endReason: text(),
    endedBy: userRef(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "management_mandate_owner_fk",
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [propertyOwner.organizationId, propertyOwner.id],
    }),
    foreignKey({
      name: "management_mandate_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    uniqueIndex("management_mandate_active_unit")
      .on(t.organizationId, t.unitId)
      .where(sql`${t.status} = 'active'`),
    index().on(t.organizationId, t.ownerId),
    check("management_mandate_fee", sql`${t.feeRateBp} between 0 and 3000`),
    check("management_mandate_start", sql`${t.startOn} >= ${t.signedOn}`),
    check(
      "management_mandate_ended",
      sql`(${t.status} = 'ended') = (${t.endedOn} is not null and ${t.endReason} is not null)
        and (${t.endedOn} is null or ${t.endedOn} >= ${t.startOn})`,
    ),
  ],
);

/**
 * Bail (module 5): a unit the promoter still owns, rented to a tenant (person or company) for
 * `duration_months` from `start_on`, rent and charges paid in advance every `frequency`. The
 * schedule is derived (`buildRentPeriods`); the unit is `rented` while the lease is active.
 * A renewal is a new lease (`renewed_from_id`) that carries the deposit over.
 */
export const lease = pgTable(
  "lease",
  {
    id: id(),
    organizationId: organizationId(),
    /** BAL-YYYY-NNNNNN */
    number: text().notNull(),
    unitId: uuid().notNull(),
    projectId: uuid().notNull(),
    kind: leaseKind().notNull(),
    tenantName: text().notNull(),
    tenantNameAr: text(),
    /** NIN of a person, RC number of a company. */
    tenantIdNumber: text(),
    tenantPhone: text().notNull(),
    /** The tenant agreed to WhatsApp notifications (CLAUDE.md §7 WhatsApp). */
    tenantWhatsappOptIn: boolean().notNull().default(false),
    tenantEmail: text(),
    tenantAddress: text(),
    /** Trade carried on in a commercial unit. */
    activity: text(),
    /** The guarantor (caution) who answers for the tenant, if any. */
    guarantorName: text(),
    guarantorIdNumber: text(),
    guarantorPhone: text(),
    guarantorAddress: text(),
    signedOn: date({ mode: "string" }).notNull(),
    startOn: date({ mode: "string" }).notNull(),
    durationMonths: integer().notNull(),
    /** Last day of the term (start + duration − 1 day). */
    endOn: date({ mode: "string" }).notNull(),
    monthlyRent: money().notNull(),
    monthlyCharges: money()
      .notNull()
      .default(sql`0`),
    frequency: rentFrequency().notNull().default("monthly"),
    /** Dépôt de garantie asked for. */
    deposit: money()
      .notNull()
      .default(sql`0`),
    /** Deposit already held when this lease renews another. */
    depositCarried: money()
      .notNull()
      .default(sql`0`),
    renewedFromId: uuid(),
    status: leaseStatus().notNull().default("active"),
    endedOn: date({ mode: "string" }),
    endReason: text(),
    endedBy: userRef(),
    /** Deposit settled when the tenant left: refunded + retained = collected. */
    depositSettledOn: date({ mode: "string" }),
    depositRefunded: money(),
    depositRetained: money(),
    depositRetentionReason: text(),
    /** How and from which cash desk or account the deposit was refunded. */
    depositRefundMethod: paymentMethod(),
    depositRefundAccountId: uuid(),
    contractScanFileId: uuid(),
    /**
     * Registration at the tax office (inspection de l'enregistrement): day, office, reference
     * and the duties paid (CLAUDE.md §7 Rentals).
     */
    registeredOn: date({ mode: "string" }),
    registrationOffice: text(),
    registrationReference: text(),
    registrationDuty: money(),
    /** The tenant as occupant of the unit when it belongs to a residence (portal, tickets). */
    occupantId: uuid(),
    /** A unit let for its owner (management mandate): the rents are the owner's. */
    mandateId: uuid(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    foreignKey({
      name: "lease_deposit_account_fk",
      columns: [t.organizationId, t.depositRefundAccountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    foreignKey({
      name: "lease_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    foreignKey({
      name: "lease_mandate_fk",
      columns: [t.organizationId, t.mandateId],
      foreignColumns: [managementMandate.organizationId, managementMandate.id],
    }),
    foreignKey({
      name: "lease_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    foreignKey({
      name: "lease_renewed_from_fk",
      columns: [t.organizationId, t.renewedFromId],
      foreignColumns: [t.organizationId, t.id],
    }),
    foreignKey({
      name: "lease_occupant_fk",
      columns: [t.organizationId, t.occupantId],
      foreignColumns: [resident.organizationId, resident.id],
    }),
    foreignKey({
      name: "lease_contract_scan_fk",
      columns: [t.organizationId, t.contractScanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    uniqueIndex("lease_one_active_per_unit")
      .on(t.organizationId, t.unitId)
      .where(sql`${t.status} = 'active'`),
    uniqueIndex("lease_renewed_once")
      .on(t.organizationId, t.renewedFromId)
      .where(sql`${t.renewedFromId} is not null`),
    index().on(t.organizationId, t.endOn),
    check("lease_duration", sql`${t.durationMonths} between 1 and 120`),
    check("lease_term", sql`${t.endOn} >= ${t.startOn}`),
    check(
      "lease_registration",
      sql`(${t.registeredOn} is null) = (${t.registrationOffice} is null)
        and (${t.registeredOn} is null) = (${t.registrationReference} is null)
        and (${t.registeredOn} is null) = (${t.registrationDuty} is null)
        and (${t.registeredOn} is null or ${t.registeredOn} >= ${t.signedOn})
        and (${t.registrationDuty} is null or ${t.registrationDuty} >= 0)`,
    ),
    check(
      "lease_amounts",
      sql`${t.monthlyRent} > 0 and ${t.monthlyCharges} >= 0 and ${t.deposit} >= 0
        and ${t.depositCarried} >= 0`,
    ),
    check(
      "lease_ended",
      sql`(${t.status} = 'ended') = (${t.endedOn} is not null and ${t.endReason} is not null)`,
    ),
    check(
      "lease_deposit_settled",
      sql`(${t.depositSettledOn} is null) = (${t.depositRefunded} is null)
        and (${t.depositSettledOn} is null) = (${t.depositRetained} is null)
        and (${t.depositRefunded} is null or ${t.depositRefunded} >= 0)
        and (${t.depositRetained} is null or ${t.depositRetained} >= 0)`,
    ),
  ],
);

/**
 * Encaissement of a lease: rent (quittance de loyer) or the security deposit, each with its
 * receipt QIT-… issued in the same transaction. Immutable like every payment: only its
 * cancellation, a cheque's clearance and the PDF link change (column grants).
 */
export const rentPayment = pgTable(
  "rent_payment",
  {
    id: id(),
    organizationId: organizationId(),
    leaseId: uuid().notNull(),
    kind: rentPaymentKind().notNull(),
    amount: money().notNull(),
    method: paymentMethod().notNull(),
    /** Day the money (or cheque) was received. */
    paidOn: date({ mode: "string" }).notNull(),
    reference: text(),
    bank: text(),
    /** Who handed the payment over, as printed on the receipt. */
    payerName: text().notNull(),
    chequeClearedOn: date({ mode: "string" }),
    notes: text(),
    receiptNumber: text().notNull(),
    /** Rent periods the payment settled when it was recorded, as printed on the quittance. */
    allocation: jsonb()
      .$type<{ fromOn: string; toOn: string; amount: string; settlementYear?: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The cash desk or account the money landed on (CLAUDE.md §7 Treasury). */
    accountId: uuid(),
    status: paymentStatus().notNull().default("valid"),
    cancelledAt: instant(),
    cancelledBy: userRef(),
    cancellationReason: text(),
    pdfFileId: uuid(),
    recordedBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.receiptNumber),
    foreignKey({
      name: "rent_payment_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    index().on(t.organizationId, t.accountId),
    foreignKey({
      name: "rent_payment_lease_fk",
      columns: [t.organizationId, t.leaseId],
      foreignColumns: [lease.organizationId, lease.id],
    }),
    foreignKey({
      name: "rent_payment_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.leaseId),
    index().on(t.organizationId, t.paidOn),
    check("rent_payment_amount", sql`${t.amount} > 0`),
    check("rent_payment_method", sql`${t.method} <> 'bank_loan'`),
    check(
      "rent_payment_cancellation",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancellationReason} is not null)`,
    ),
  ],
);

export const inspectionKind = pgEnum("inspection_kind", inspectionKinds);

/**
 * État des lieux d'entrée / de sortie of a lease: the condition of each element of the unit,
 * the meters and keys, signed by both parties; one of each kind, final once recorded (its
 * bilingual report is rendered by the worker).
 */
export const leaseInspection = pgTable(
  "lease_inspection",
  {
    id: id(),
    organizationId: organizationId(),
    leaseId: uuid().notNull(),
    kind: inspectionKind().notNull(),
    inspectedOn: date({ mode: "string" }).notNull(),
    items: jsonb()
      .$type<{ element: string; condition: InspectionCondition; notes: string | null }[]>()
      .notNull(),
    electricityMeter: text(),
    gasMeter: text(),
    waterMeter: text(),
    keysCount: integer(),
    observations: text(),
    pdfFileId: uuid(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("lease_inspection_kind_key").on(t.organizationId, t.leaseId, t.kind),
    foreignKey({
      name: "lease_inspection_lease_fk",
      columns: [t.organizationId, t.leaseId],
      foreignColumns: [lease.organizationId, lease.id],
    }),
    foreignKey({
      name: "lease_inspection_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    check("lease_inspection_keys", sql`${t.keysCount} is null or ${t.keysCount} >= 0`),
  ],
);

/**
 * A rent revision (indexation, renegotiation): from a period of the lease on, the monthly rent
 * and charges provision change. The schedule takes, for each period, the latest revision
 * effective by its first day. Append-only.
 */
export const leaseRevision = pgTable(
  "lease_revision",
  {
    id: id(),
    organizationId: organizationId(),
    leaseId: uuid().notNull(),
    effectiveOn: date({ mode: "string" }).notNull(),
    monthlyRent: money().notNull(),
    monthlyCharges: money()
      .notNull()
      .default(sql`0`),
    reason: text().notNull(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique("lease_revision_day_key").on(t.organizationId, t.leaseId, t.effectiveOn),
    foreignKey({
      name: "lease_revision_lease_fk",
      columns: [t.organizationId, t.leaseId],
      foreignColumns: [lease.organizationId, lease.id],
    }),
    check("lease_revision_amounts", sql`${t.monthlyRent} > 0 and ${t.monthlyCharges} >= 0`),
  ],
);

/**
 * Régularisation annuelle des charges of a lease: the provisions billed for a year against the
 * actual charges; the balance is due from the tenant (positive) or credited to them (negative)
 * in the rent account. Cancelled with a reason, never edited; one live per lease and year.
 */
export const leaseChargeSettlement = pgTable(
  "lease_charge_settlement",
  {
    id: id(),
    organizationId: organizationId(),
    leaseId: uuid().notNull(),
    year: integer().notNull(),
    provisions: money().notNull(),
    actual: money().notNull(),
    /** actual − provisions: due from the tenant when positive, a credit when negative. */
    balance: money().notNull(),
    dueOn: date({ mode: "string" }).notNull(),
    note: text(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    cancelledAt: instant(),
    cancellationReason: text(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "lease_charge_settlement_lease_fk",
      columns: [t.organizationId, t.leaseId],
      foreignColumns: [lease.organizationId, lease.id],
    }),
    uniqueIndex("lease_charge_settlement_live_key")
      .on(t.organizationId, t.leaseId, t.year)
      .where(sql`${t.cancelledAt} is null`),
    check(
      "lease_charge_settlement_amounts",
      sql`${t.provisions} >= 0 and ${t.actual} >= 0 and ${t.balance} = ${t.actual} - ${t.provisions}`,
    ),
  ],
);

/**
 * Relevé de gérance (`RDG-`): the rents collected for an owner up to `period_to` and not
 * reported yet (and the reversals of reported ones cancelled since), less the fees at each
 * mandate's rate and other deductions; the net is paid out from an account. Lines frozen at
 * issue; cancelled with a reason while unpaid.
 */
export const ownerStatement = pgTable(
  "owner_statement",
  {
    id: id(),
    organizationId: organizationId(),
    number: text().notNull(),
    ownerId: uuid().notNull(),
    periodFrom: date({ mode: "string" }),
    periodTo: date({ mode: "string" }).notNull(),
    issuedOn: date({ mode: "string" }).notNull(),
    collected: money().notNull(),
    fees: money().notNull(),
    deductions: money().notNull(),
    net: money().notNull(),
    /** Each rent (or reversal) with its fee, as printed (amounts as centime strings). */
    lines: jsonb()
      .$type<
        {
          leaseNumber: string;
          tenantName: string;
          unitCode: string;
          receiptNumber: string;
          paidOn: string;
          amount: string;
          feeRateBp: number;
          fee: string;
          reversal: boolean;
        }[]
      >()
      .notNull(),
    /** Other deductions (repairs paid for the owner…), amounts as centime strings. */
    extras: jsonb()
      .$type<(Omit<StatementExtra, "amount"> & { amount: string })[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: ownerStatementStatus().notNull().default("issued"),
    paidOn: date({ mode: "string" }),
    paymentMethod: paymentMethod(),
    paymentReference: text(),
    /** The cash desk or account the payout left (CLAUDE.md §7 Treasury). */
    accountId: uuid(),
    paidBy: userRef(),
    cancelledAt: instant(),
    cancellationReason: text(),
    cancelledBy: userRef(),
    pdfFileId: uuid(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    foreignKey({
      name: "owner_statement_owner_fk",
      columns: [t.organizationId, t.ownerId],
      foreignColumns: [propertyOwner.organizationId, propertyOwner.id],
    }),
    foreignKey({
      name: "owner_statement_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    foreignKey({
      name: "owner_statement_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.ownerId),
    check(
      "owner_statement_amounts",
      sql`${t.net} = ${t.collected} - ${t.fees} - ${t.deductions} and ${t.net} >= 0
        and ${t.deductions} >= 0`,
    ),
    check(
      "owner_statement_paid",
      sql`(${t.status} = 'paid') = (${t.paidOn} is not null and ${t.paymentMethod} is not null)`,
    ),
    check(
      "owner_statement_cancelled",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancellationReason} is not null)`,
    ),
  ],
);

/**
 * The rent payments a statement reported or reversed (`reversal`): each at most once per kind
 * among live statements; a cancelled statement's items are deleted.
 */
export const ownerStatementItem = pgTable(
  "owner_statement_item",
  {
    organizationId: organizationId(),
    statementId: uuid().notNull(),
    rentPaymentId: uuid().notNull(),
    reversal: boolean().notNull().default(false),
  },
  (t) => [
    unique("owner_statement_item_once").on(t.organizationId, t.rentPaymentId, t.reversal),
    index().on(t.organizationId, t.statementId),
    foreignKey({
      name: "owner_statement_item_statement_fk",
      columns: [t.organizationId, t.statementId],
      foreignColumns: [ownerStatement.organizationId, ownerStatement.id],
    }),
    foreignKey({
      name: "owner_statement_item_payment_fk",
      columns: [t.organizationId, t.rentPaymentId],
      foreignColumns: [rentPayment.organizationId, rentPayment.id],
    }),
  ],
);
