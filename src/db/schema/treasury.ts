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
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  chequeSources,
  movementDirections,
  movementKinds,
  treasuryAccountKinds,
} from "../../lib/treasury";

import { createdAt, id, instant, money, organizationId, timestamps, userRef } from "./_columns";
import { file } from "./files";

export const treasuryAccountKind = pgEnum("treasury_account_kind", treasuryAccountKinds);
export const movementKind = pgEnum("movement_kind", movementKinds);
export const movementDirection = pgEnum("movement_direction", movementDirections);

/**
 * A cash desk (caisse), bank or CCP account of the organization. Collections land on one
 * (chosen, else the default account of their method's kind); its balance is derived from its
 * opening balance, the valid collections and the movements. Closed accounts take no new money.
 */
export const treasuryAccount = pgTable(
  "treasury_account",
  {
    id: id(),
    organizationId: organizationId(),
    kind: treasuryAccountKind().notNull(),
    name: text().notNull(),
    /** Bank (or post office) holding the account; null for a cash desk. */
    bankName: text(),
    /** RIB / RIP. */
    accountNumber: text(),
    openingBalance: money()
      .notNull()
      .default(sql`0`),
    openingOn: date({ mode: "string" }).notNull(),
    /** The account its kind's collections land on when none is chosen. */
    isDefault: boolean().notNull().default(false),
    closedOn: date({ mode: "string" }),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    uniqueIndex("treasury_account_one_default")
      .on(t.organizationId, t.kind)
      .where(sql`${t.isDefault} and ${t.closedOn} is null`),
    check("treasury_account_opening", sql`${t.openingBalance} >= 0`),
  ],
);

/**
 * A manual movement of an account (income, expense, bank fee, one side of a transfer, a cash
 * count's adjustment). Immutable: cancelled with a reason (grants), never deleted.
 */
export const treasuryMovement = pgTable(
  "treasury_movement",
  {
    id: id(),
    organizationId: organizationId(),
    accountId: uuid().notNull(),
    kind: movementKind().notNull(),
    direction: movementDirection().notNull(),
    amount: money().notNull(),
    movedOn: date({ mode: "string" }).notNull(),
    label: text().notNull(),
    /** Expense / income category (free text: « Fournitures », « Frais de notaire »…). */
    category: text(),
    reference: text(),
    /** The other side of a transfer (the same `transferId` on both rows). */
    transferId: uuid(),
    counterAccountId: uuid(),
    createdAt: createdAt(),
    createdBy: userRef(),
    cancelledAt: instant(),
    cancelledBy: userRef(),
    cancellationReason: text(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "treasury_movement_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    foreignKey({
      name: "treasury_movement_counter_fk",
      columns: [t.organizationId, t.counterAccountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    index().on(t.organizationId, t.accountId, t.movedOn),
    index().on(t.organizationId, t.transferId),
    check("treasury_movement_amount", sql`${t.amount} > 0`),
    check(
      "treasury_movement_transfer",
      sql`(${t.kind} = 'transfer') = (${t.transferId} is not null and ${t.counterAccountId} is not null)`,
    ),
  ],
);

/**
 * Arrêté de caisse: the cash counted in a cash desk on a day against the ledger's balance;
 * a difference is booked as an adjustment movement. Immutable.
 */
export const cashCount = pgTable(
  "cash_count",
  {
    id: id(),
    organizationId: organizationId(),
    accountId: uuid().notNull(),
    countedOn: date({ mode: "string" }).notNull(),
    expected: money().notNull(),
    counted: money().notNull(),
    /** counted − expected (negative = missing cash). */
    difference: money().notNull(),
    note: text(),
    adjustmentId: uuid(),
    countedBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "cash_count_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    foreignKey({
      name: "cash_count_adjustment_fk",
      columns: [t.organizationId, t.adjustmentId],
      foreignColumns: [treasuryMovement.organizationId, treasuryMovement.id],
    }),
    index().on(t.organizationId, t.accountId, t.countedOn),
    check(
      "cash_count_amounts",
      sql`${t.counted} >= 0 and ${t.difference} = ${t.counted} - ${t.expected}`,
    ),
  ],
);

export const chequeSource = pgEnum("cheque_source", chequeSources);

/**
 * Bordereau de remise de chèques (BRC-…): cheques received and not cleared, handed to the bank
 * together on a bank or CCP account. Its cheques are cleared together once the bank credits
 * them (`cleared_on`). Immutable but for the clearance and its PDF link.
 */
export const chequeDeposit = pgTable(
  "cheque_deposit",
  {
    id: id(),
    organizationId: organizationId(),
    number: text().notNull(),
    accountId: uuid().notNull(),
    depositedOn: date({ mode: "string" }).notNull(),
    total: money().notNull(),
    count: integer().notNull(),
    clearedOn: date({ mode: "string" }),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    pdfFileId: uuid(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.number),
    foreignKey({
      name: "cheque_deposit_account_fk",
      columns: [t.organizationId, t.accountId],
      foreignColumns: [treasuryAccount.organizationId, treasuryAccount.id],
    }),
    foreignKey({
      name: "cheque_deposit_pdf_fk",
      columns: [t.organizationId, t.pdfFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.accountId),
    check("cheque_deposit_amounts", sql`${t.total} > 0 and ${t.count} > 0`),
  ],
);

/** A cheque on a deposit slip, as printed (one slip per cheque). Append-only. */
export const chequeDepositItem = pgTable(
  "cheque_deposit_item",
  {
    id: id(),
    organizationId: organizationId(),
    depositId: uuid().notNull(),
    source: chequeSource().notNull(),
    /** The payment (sale), charge payment or rent payment the cheque settled. */
    paymentId: uuid().notNull(),
    amount: money().notNull(),
    chequeNumber: text(),
    bank: text(),
    payerName: text().notNull(),
    receivedOn: date({ mode: "string" }).notNull(),
  },
  (t) => [
    unique("cheque_deposit_item_once").on(t.organizationId, t.source, t.paymentId),
    foreignKey({
      name: "cheque_deposit_item_deposit_fk",
      columns: [t.organizationId, t.depositId],
      foreignColumns: [chequeDeposit.organizationId, chequeDeposit.id],
    }),
    index().on(t.organizationId, t.depositId),
    check("cheque_deposit_item_amount", sql`${t.amount} > 0`),
  ],
);
