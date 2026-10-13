import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  consolePaymentMethods,
  type InvoiceParty,
  invoiceLineKinds,
  vatRegimes,
} from "../../lib/billing";
import type { Module } from "../../lib/modules";
import {
  addonBases,
  addonCodes,
  billingPeriods,
  type PlanLimits,
  subscriptionPrograms,
  subscriptionStatuses,
} from "../../lib/subscriptions";

import { createdAt, id, instant, money, organizationId, updatedAt } from "./_columns";
import { organization, user } from "./auth";

/**
 * The operator's layer (CLAUDE.console.md §3): schema `console`, written by the role
 * `realestate_console` only. No RLS there — grants protect it; the app role reaches nothing in
 * it. Tenants read their rights from `tenant_entitlement` (public, RLS) below.
 */
export const consoleSchema = pgSchema("console");

/** Shared by the subscription and its mirror in each organization (`tenant_entitlement`). */
export const subscriptionStatus = pgEnum("subscription_status", subscriptionStatuses);
export const subscriptionProgram = consoleSchema.enum("subscription_program", subscriptionPrograms);
export const billingPeriod = consoleSchema.enum("billing_period", billingPeriods);
export const addonCode = consoleSchema.enum("addon_code", addonCodes);
export const addonBasis = consoleSchema.enum("addon_basis", addonBases);
export const consoleDocumentType = consoleSchema.enum("document_type", ["invoice", "credit_note"]);
export const vatRegime = consoleSchema.enum("vat_regime", vatRegimes);
export const invoiceLineKind = consoleSchema.enum("invoice_line_kind", invoiceLineKinds);
export const consolePaymentMethod = consoleSchema.enum("payment_method", consolePaymentMethods);

/** A client: one or more organizations (a gérant's SARLs) paying one subscription. */
export const billingAccount = consoleSchema.table("billing_account", {
  id: id(),
  /** Invoicing identity, prefilled from its first organization, editable. */
  legalName: text().notNull(),
  address: text(),
  wilaya: text(),
  rcNumber: text(),
  nif: text(),
  nis: text(),
  aiNumber: text(),
  contactName: text(),
  email: text(),
  phone: text(),
  notes: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** An organization belongs to one billing account. */
export const accountOrganization = consoleSchema.table(
  "account_organization",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: "restrict" }),
    billingAccountId: uuid()
      .notNull()
      .references(() => billingAccount.id, { onDelete: "restrict" }),
    addedAt: createdAt(),
  },
  (t) => [index().on(t.billingAccountId)],
);

/** A plan: prices per period (HT), modules, caps. Read-only once used; archived, never deleted. */
export const plan = consoleSchema.table(
  "plan",
  {
    id: id(),
    code: text().notNull().unique(),
    nameFr: text().notNull(),
    nameAr: text().notNull(),
    yearlyPrice: money().notNull(),
    quarterlyPrice: money().notNull(),
    setupFee: money()
      .notNull()
      .default(sql`0`),
    modules: text()
      .array()
      .$type<Module[]>()
      .notNull()
      .default(sql`'{}'`),
    limits: jsonb().$type<PlanLimits>().notNull(),
    /** No public price (Groupe): the subscription's price is negotiated. */
    onQuote: boolean().notNull().default(false),
    archivedAt: instant(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "plan_prices",
      sql`${t.yearlyPrice} >= 0 and ${t.quarterlyPrice} >= 0 and ${t.setupFee} >= 0`,
    ),
  ],
);

/** An add-on: one module sold on top of a plan. One live row per code; archived, never deleted. */
export const addon = consoleSchema.table(
  "addon",
  {
    id: id(),
    code: addonCode().notNull(),
    basis: addonBasis().notNull(),
    /** HT per period; for `per_managed_lot`, the price per lot and month (both columns). */
    yearlyPrice: money().notNull(),
    quarterlyPrice: money().notNull(),
    archivedAt: instant(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("addon_live_code")
      .on(t.code)
      .where(sql`${t.archivedAt} is null`),
    check("addon_prices", sql`${t.yearlyPrice} >= 0 and ${t.quarterlyPrice} >= 0`),
  ],
);

/** The subscription of a billing account (one each): plan, negotiated price, state, periods. */
export const subscription = consoleSchema.table(
  "subscription",
  {
    id: id(),
    billingAccountId: uuid()
      .notNull()
      .unique()
      .references(() => billingAccount.id, { onDelete: "restrict" }),
    planId: uuid()
      .notNull()
      .references(() => plan.id, { onDelete: "restrict" }),
    status: subscriptionStatus().notNull(),
    program: subscriptionProgram().notNull().default("standard"),
    activatedAt: instant(),
    pilotEndsOn: date({ mode: "string" }),
    billingPeriod: billingPeriod().notNull().default("yearly"),
    /** HT per period, prefilled from the plan, negotiable. */
    price: money().notNull(),
    discountBp: integer().notNull().default(0),
    /** No price increase (plan or add-on) before this day (design partners' founder price). */
    priceLockedUntil: date({ mode: "string" }),
    limitOverrides: jsonb().$type<Partial<PlanLimits>>().notNull().default({}),
    currentPeriodStart: date({ mode: "string" }),
    currentPeriodEnd: date({ mode: "string" }),
    graceDays: integer().notNull().default(15),
    statusReason: text(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("subscription_price", sql`${t.price} >= 0`),
    check("subscription_discount", sql`${t.discountBp} between 0 and 10000`),
    check("subscription_grace", sql`${t.graceDays} >= 0`),
    check(
      "subscription_period",
      sql`${t.currentPeriodEnd} is null or ${t.currentPeriodStart} <= ${t.currentPeriodEnd}`,
    ),
  ],
);

/** An add-on taken by a subscription, its price snapshotted (negotiable); one live row per code. */
export const subscriptionAddon = consoleSchema.table(
  "subscription_addon",
  {
    id: id(),
    subscriptionId: uuid()
      .notNull()
      .references(() => subscription.id, { onDelete: "restrict" }),
    addonCode: addonCode().notNull(),
    price: money().notNull(),
    addedOn: date({ mode: "string" }).notNull(),
    removedOn: date({ mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("subscription_addon_live")
      .on(t.subscriptionId, t.addonCode)
      .where(sql`${t.removedOn} is null`),
    check("subscription_addon_price", sql`${t.price} >= 0`),
  ],
);

/** The goals agreed with a client for its pilot (CLAUDE.console.md §2), ticked by the operator. */
export const pilotGoal = consoleSchema.table(
  "pilot_goal",
  {
    id: id(),
    subscriptionId: uuid()
      .notNull()
      .references(() => subscription.id, { onDelete: "restrict" }),
    position: integer().notNull(),
    label: text().notNull(),
    doneOn: date({ mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.subscriptionId, t.position)],
);

/**
 * A single-use link with which a promoter signs up and creates an organization (CLAUDE.console.md
 * §8): a new client, or another SARL of an existing account. Only the token's SHA-256 is kept;
 * revoked, never deleted.
 */
export const provision = consoleSchema.table(
  "provision",
  {
    id: id(),
    tokenHash: text().notNull().unique(),
    email: text().notNull(),
    legalName: text().notNull(),
    /** Null: a new client; else the account the new organization joins. */
    billingAccountId: uuid().references(() => billingAccount.id, { onDelete: "restrict" }),
    planId: uuid()
      .notNull()
      .references(() => plan.id, { onDelete: "restrict" }),
    program: subscriptionProgram().notNull().default("standard"),
    pilotDays: integer().notNull().default(30),
    expiresAt: instant().notNull(),
    usedAt: instant(),
    /** The organization created with it (no foreign key: kept after a purge). */
    organizationId: uuid(),
    revokedAt: instant(),
    createdBy: uuid().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.email),
    check("provision_pilot_days", sql`${t.pilotDays} between 1 and 365`),
  ],
);

/**
 * What each organization uses, measured every night (`console.usage`, CLAUDE.console.md §7): the
 * caps' figures, the storage, and the pilot's indicators. An account's usage is the sum of its
 * organizations'. Kept 400 days; no foreign key (kept after a purge).
 */
export const tenantUsage = consoleSchema.table(
  "tenant_usage",
  {
    organizationId: uuid().notNull(),
    measuredOn: date({ mode: "string" }).notNull(),
    projects: integer().notNull(),
    units: integer().notNull(),
    /** Live units not handed over, in projects not delivered: the pricing metric. */
    activeUnits: integer().notNull(),
    /** Units enrolled in live residences: the syndic add-on's metric. */
    managedLots: integer().notNull(),
    staffMembers: integer().notNull(),
    portalAccounts: integer().notNull(),
    storageBytes: bigint({ mode: "number" }).notNull(),
    receipts30d: integer().notNull(),
    reminders30d: integer().notNull(),
    activeMembers30d: integer().notNull(),
    leads30d: integer().notNull(),
    lastActivityAt: instant(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.measuredOn] })],
);

/**
 * The operator itself (CLAUDE.console.md §3, §11): one row, snapshotted on each invoice — legal
 * identity, bank and RIB, VAT regime and rate, payment terms, the invoices' footer and logo.
 */
export const operatorProfile = consoleSchema.table(
  "operator_profile",
  {
    id: smallint().primaryKey().default(1),
    legalName: text().notNull(),
    brand: text(),
    legalForm: text(),
    address: text(),
    wilaya: text(),
    phone: text(),
    email: text(),
    rcNumber: text(),
    nif: text(),
    nis: text(),
    aiNumber: text(),
    bank: text(),
    rib: text(),
    vatRegime: vatRegime().notNull().default("vat"),
    vatRateBp: integer().notNull().default(1900),
    paymentTermsDays: integer().notNull().default(15),
    footerFr: text(),
    footerAr: text(),
    logoKey: text(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("operator_profile_single", sql`${t.id} = 1`),
    check("operator_profile_vat", sql`${t.vatRateBp} between 0 and 10000`),
    check("operator_profile_terms", sql`${t.paymentTermsDays} between 0 and 365`),
  ],
);

/**
 * An operator invoice (CLAUDE.console.md §11): numbered `FAC-`, the seller and the buyer
 * snapshotted, totals HT / VAT / TTC. Immutable but for its PDF (grants); never edited nor
 * cancelled — a credit note corrects it. Its state (due, overdue, paid, credited) is derived.
 */
export const invoice = consoleSchema.table(
  "invoice",
  {
    id: id(),
    billingAccountId: uuid()
      .notNull()
      .references(() => billingAccount.id, { onDelete: "restrict" }),
    number: text().notNull().unique(),
    issuedOn: date({ mode: "string" }).notNull(),
    dueOn: date({ mode: "string" }).notNull(),
    /** The subscription period it invoices (null: no subscription line). */
    periodStart: date({ mode: "string" }),
    periodEnd: date({ mode: "string" }),
    seller: jsonb().$type<InvoiceParty>().notNull(),
    buyer: jsonb().$type<InvoiceParty>().notNull(),
    /** Null: no VAT (the operator's regime). */
    vatRateBp: integer(),
    totalHt: money().notNull(),
    totalVat: money().notNull(),
    totalTtc: money().notNull(),
    pdfKey: text(),
    issuedBy: uuid().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.billingAccountId, t.issuedOn),
    check(
      "invoice_totals",
      sql`${t.totalHt} >= 0 and ${t.totalVat} >= 0 and ${t.totalTtc} = ${t.totalHt} + ${t.totalVat}`,
    ),
    check("invoice_due", sql`${t.dueOn} >= ${t.issuedOn}`),
  ],
);

/** A line of an invoice: quantity × unit price (HT); syndic lines count lot-months. */
export const invoiceLine = consoleSchema.table(
  "invoice_line",
  {
    id: id(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoice.id, { onDelete: "restrict" }),
    position: integer().notNull(),
    kind: invoiceLineKind().notNull(),
    /** The add-on a line bills (an add-on or its true-up). */
    addonCode: addonCode(),
    labelFr: text().notNull(),
    labelAr: text().notNull(),
    periodStart: date({ mode: "string" }),
    periodEnd: date({ mode: "string" }),
    quantity: integer().notNull(),
    unitPrice: money().notNull(),
    amount: money().notNull(),
  },
  (t) => [
    index().on(t.invoiceId, t.position),
    check(
      "invoice_line_amount",
      sql`${t.quantity} > 0 and ${t.unitPrice} >= 0 and ${t.amount} = ${t.quantity} * ${t.unitPrice}`,
    ),
  ],
);

/** A credit note `AVO-` on an invoice: at most what remains unpaid, split at the invoice's rate. */
export const creditNote = consoleSchema.table(
  "credit_note",
  {
    id: id(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoice.id, { onDelete: "restrict" }),
    billingAccountId: uuid()
      .notNull()
      .references(() => billingAccount.id, { onDelete: "restrict" }),
    number: text().notNull().unique(),
    issuedOn: date({ mode: "string" }).notNull(),
    amountHt: money().notNull(),
    amountVat: money().notNull(),
    amountTtc: money().notNull(),
    reason: text().notNull(),
    pdfKey: text(),
    issuedBy: uuid().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.invoiceId),
    check(
      "credit_note_amounts",
      sql`${t.amountTtc} > 0 and ${t.amountHt} >= 0 and ${t.amountVat} >= 0 and ${t.amountTtc} = ${t.amountHt} + ${t.amountVat}`,
    ),
  ],
);

/** A client's payment of an invoice (never cash); cancelled with a reason only (a bounced cheque). */
export const consolePayment = consoleSchema.table(
  "payment",
  {
    id: id(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoice.id, { onDelete: "restrict" }),
    billingAccountId: uuid()
      .notNull()
      .references(() => billingAccount.id, { onDelete: "restrict" }),
    paidOn: date({ mode: "string" }).notNull(),
    amount: money().notNull(),
    method: consolePaymentMethod().notNull(),
    reference: text(),
    recordedBy: uuid().references(() => user.id, { onDelete: "restrict" }),
    cancelledAt: instant(),
    cancelReason: text(),
    cancelledBy: uuid().references(() => user.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.invoiceId),
    check("console_payment_amount", sql`${t.amount} > 0`),
    check("console_payment_cancel", sql`(${t.cancelledAt} is null) = (${t.cancelReason} is null)`),
  ],
);

/** Gapless counters of the operator's invoices (FAC-) and credit notes (AVO-) per year. */
export const consoleDocumentSequence = consoleSchema.table(
  "document_sequence",
  {
    docType: consoleDocumentType().notNull(),
    year: smallint().notNull(),
    lastValue: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.docType, t.year] })],
);

/** The operator's own audit trail (append-only through grants). */
export const consoleAuditLog = consoleSchema.table(
  "audit_log",
  {
    id: id(),
    /** null for the console's jobs and the seed. */
    actorUserId: uuid().references(() => user.id, { onDelete: "restrict" }),
    action: text().notNull(),
    billingAccountId: uuid().references(() => billingAccount.id, { onDelete: "restrict" }),
    /** No foreign key: the trail outlives a purged organization. */
    organizationId: uuid(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.billingAccountId, t.createdAt), index().on(t.createdAt)],
);

/**
 * What an organization's subscription allows (CLAUDE.console.md §3), mirrored from its billing
 * account's subscription by the console (`syncEntitlement`). A tenant table (forced RLS): the app
 * reads its own row, only the console role writes.
 */
export const tenantEntitlement = pgTable("tenant_entitlement", {
  organizationId: organizationId().primaryKey(),
  status: subscriptionStatus().notNull(),
  /** Entitled modules: the plan's and the live add-ons'. */
  modules: text()
    .array()
    .$type<Module[]>()
    .notNull()
    .default(sql`'{}'`),
  limits: jsonb().$type<PlanLimits>().notNull(),
  pilotEndsOn: date({ mode: "string" }),
  currentPeriodEnd: date({ mode: "string" }),
  updatedAt: updatedAt(),
});
