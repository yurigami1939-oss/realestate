import { sql } from "drizzle-orm";
import {
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
