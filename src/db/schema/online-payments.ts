import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  gatewayEnvironments,
  onlinePaymentPurposes,
  onlinePaymentStatuses,
} from "../../lib/online-payments";

import { createdAt, id, instant, money, organizationId, updatedAt, userRef } from "./_columns";
import { chargePayment } from "./charges";
import { residence, residenceUnit } from "./residences";
import { payment, reservation } from "./sales";

export const gatewayEnvironment = pgEnum("gateway_environment", gatewayEnvironments);
export const onlinePaymentPurpose = pgEnum("online_payment_purpose", onlinePaymentPurposes);
export const onlinePaymentStatus = pgEnum("online_payment_status", onlinePaymentStatuses);

/**
 * The organization's SATIM merchant account (CIB / Edahabia): each promoter is paid on its own
 * account. The password is encrypted (src/server/secrets.ts) and never sent to a browser.
 */
export const paymentGateway = pgTable("payment_gateway", {
  organizationId: organizationId().primaryKey(),
  enabled: boolean().notNull().default(false),
  environment: gatewayEnvironment().notNull().default("test"),
  /** Merchant login, its password (encrypted) and the terminal (`force_terminal_id`). */
  username: text().notNull(),
  passwordEncrypted: text().notNull(),
  terminalId: text().notNull(),
  /** What the portal lets buyers and co-owners pay online. */
  salesEnabled: boolean().notNull().default(true),
  chargesEnabled: boolean().notNull().default(true),
  updatedAt: updatedAt(),
  updatedBy: userRef(),
});

/**
 * A card payment started from the portal (CLAUDE.md §7 Online payment): registered with the
 * gateway, confirmed by it, then recorded as the sale's payment (receipt REC-) or the unit's
 * charge payment (receipt RCH-). Never deleted.
 */
export const onlinePayment = pgTable(
  "online_payment",
  {
    id: id(),
    organizationId: organizationId(),
    purpose: onlinePaymentPurpose().notNull(),
    /** The sale paid (`sale`), or the residence and unit whose charges are paid (`charges`). */
    reservationId: uuid(),
    residenceId: uuid(),
    unitId: uuid(),
    amount: money().notNull(),
    /** Sent to the gateway: 10 characters, unique per organization. */
    orderNumber: text().notNull(),
    environment: gatewayEnvironment().notNull(),
    status: onlinePaymentStatus().notNull().default("created"),
    /** The gateway's order (SATIM `mdOrder`) and its payment page. */
    gatewayOrderId: text(),
    formUrl: text(),
    /** The portal account that pays, the name printed on the receipt, its language. */
    userId: userRef().notNull(),
    payerName: text().notNull(),
    locale: text().notNull(),
    description: text().notNull(),
    /** Last answer of the gateway: order status, error code, message, authorization, card. */
    gatewayStatus: smallint(),
    gatewayError: text(),
    gatewayMessage: text(),
    approvalCode: text(),
    cardPan: text(),
    checkedAt: instant(),
    paidAt: instant(),
    /** The payment it was recorded as (with its receipt). */
    paymentId: uuid(),
    chargePaymentId: uuid(),
    /** Paid but not recorded (sale closed, balance already settled…): message key. */
    issue: text(),
    refundedAt: instant(),
    refundedBy: userRef(),
    refundReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.orderNumber),
    foreignKey({
      name: "online_payment_reservation_fk",
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [reservation.organizationId, reservation.id],
    }),
    foreignKey({
      name: "online_payment_residence_fk",
      columns: [t.organizationId, t.residenceId],
      foreignColumns: [residence.organizationId, residence.id],
    }),
    foreignKey({
      name: "online_payment_unit_fk",
      columns: [t.residenceId, t.unitId],
      foreignColumns: [residenceUnit.residenceId, residenceUnit.unitId],
    }),
    foreignKey({
      name: "online_payment_payment_fk",
      columns: [t.organizationId, t.paymentId],
      foreignColumns: [payment.organizationId, payment.id],
    }),
    foreignKey({
      name: "online_payment_charge_payment_fk",
      columns: [t.organizationId, t.chargePaymentId],
      foreignColumns: [chargePayment.organizationId, chargePayment.id],
    }),
    index().on(t.organizationId, t.createdAt),
    index().on(t.organizationId, t.userId),
    index().on(t.organizationId, t.reservationId),
    index().on(t.organizationId, t.residenceId, t.unitId),
    check("online_payment_amount", sql`${t.amount} >= 5000`),
    check(
      "online_payment_target",
      sql`(${t.purpose} = 'sale') = (${t.reservationId} is not null) and (${t.purpose} = 'charges') = (${t.residenceId} is not null and ${t.unitId} is not null)`,
    ),
    check(
      "online_payment_recorded",
      sql`(${t.paymentId} is null or ${t.purpose} = 'sale') and (${t.chargePaymentId} is null or ${t.purpose} = 'charges')`,
    ),
    check(
      "online_payment_refund",
      sql`(${t.status} = 'refunded') = (${t.refundedAt} is not null and ${t.refundReason} is not null)`,
    ),
  ],
);
