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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { leaseKinds, leaseStatuses, rentFrequencies, rentPaymentKinds } from "../../lib/rentals";

import { createdAt, id, instant, money, organizationId, timestamps, userRef } from "./_columns";
import { file } from "./files";
import { project, unit } from "./inventory";
import { resident } from "./residences";
import { paymentMethod, paymentStatus } from "./sales";

export const leaseKind = pgEnum("lease_kind", leaseKinds);
export const leaseStatus = pgEnum("lease_status", leaseStatuses);
export const rentFrequency = pgEnum("rent_frequency", rentFrequencies);
export const rentPaymentKind = pgEnum("rent_payment_kind", rentPaymentKinds);

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
    tenantEmail: text(),
    tenantAddress: text(),
    /** Trade carried on in a commercial unit. */
    activity: text(),
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
    contractScanFileId: uuid(),
    /** The tenant as occupant of the unit when it belongs to a residence (portal, tickets). */
    occupantId: uuid(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    foreignKey({
      name: "lease_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
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
      .$type<{ fromOn: string; toOn: string; amount: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
