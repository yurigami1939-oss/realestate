import { z } from "zod";

import { modules } from "@/lib/modules";
import {
  addonBases,
  addonCodes,
  billingPeriods,
  subscriptionPrograms,
  subscriptionStatuses,
} from "@/lib/subscriptions";
import {
  codeText,
  intText,
  moneyText,
  optionalDateText,
  optionalEmailText,
  optionalIntText,
  optionalMoneyText,
  optionalPercentText,
  optionalText,
  requiredText,
} from "@/lib/zod";

/** A plan of the catalog (CLAUDE.console.md §3): prices HT per period, modules, caps (blank = unlimited). */
export const planSchema = z.object({
  code: codeText(30).transform((v) => v.toLowerCase()),
  nameFr: requiredText(80),
  nameAr: requiredText(80),
  yearlyPrice: moneyText(),
  quarterlyPrice: moneyText(),
  setupFee: moneyText(),
  modules: z.array(z.enum(modules)),
  activeUnits: optionalIntText(1, 1_000_000),
  organizations: optionalIntText(1, 1_000),
  storageGb: optionalIntText(1, 100_000),
  onQuote: z.boolean(),
});

/** An add-on of the catalog: for `per_managed_lot`, the prices are per lot and month. */
export const addonSchema = z.object({
  code: z.enum(addonCodes),
  basis: z.enum(addonBases),
  yearlyPrice: moneyText(),
  quarterlyPrice: moneyText(),
});

/**
 * A new client (billing account) with its organizations and subscription. Blank identity fields
 * are taken from its first organization; a blank price is the catalog's for the period.
 */
export const openAccountSchema = z.object({
  legalName: optionalText(200),
  contactName: optionalText(120),
  email: optionalEmailText(),
  phone: optionalText(40),
  organizationIds: z.array(z.uuid()).min(1, "validation.required"),
  planCode: requiredText(30),
  status: z.enum(subscriptionStatuses),
  program: z.enum(subscriptionPrograms),
  billingPeriod: z.enum(billingPeriods),
  price: optionalMoneyText(),
  pilotEndsOn: optionalDateText(),
  currentPeriodStart: optionalDateText(),
  currentPeriodEnd: optionalDateText(),
  priceLockedUntil: optionalDateText(),
  addons: z.array(z.object({ code: z.enum(addonCodes), price: optionalMoneyText() })),
  notes: optionalText(2_000),
});

export type PlanInput = z.output<typeof planSchema>;
export type AddonInput = z.output<typeof addonSchema>;
export type OpenAccountInput = z.output<typeof openAccountSchema>;

/** A client's invoicing identity and contact (the operator corrects it). */
export const accountIdentitySchema = z.object({
  billingAccountId: z.uuid(),
  legalName: requiredText(200),
  address: optionalText(300),
  wilaya: optionalText(80),
  rcNumber: optionalText(40),
  nif: optionalText(40),
  nis: optionalText(40),
  aiNumber: optionalText(40),
  contactName: optionalText(120),
  email: optionalEmailText(),
  phone: optionalText(40),
  notes: optionalText(2_000),
});

/**
 * A subscription's terms: plan, period, negotiated price and discount, price lock, pilot end,
 * grace, cap overrides (blank = the plan's).
 */
export const subscriptionTermsSchema = z.object({
  billingAccountId: z.uuid(),
  planCode: requiredText(30),
  billingPeriod: z.enum(billingPeriods),
  price: moneyText(),
  discount: optionalPercentText(0, 100),
  priceLockedUntil: optionalDateText(),
  pilotEndsOn: optionalDateText(),
  graceDays: intText(0, 365),
  activeUnits: optionalIntText(1, 1_000_000),
  organizations: optionalIntText(1, 1_000),
  storageGb: optionalIntText(1, 100_000),
});

/** An add-on taken (with its negotiated price, blank = the catalog's) or dropped. */
export const subscriptionAddonSchema = z.object({
  billingAccountId: z.uuid(),
  code: z.enum(addonCodes),
  on: z.boolean(),
  price: optionalMoneyText(),
});

/** The operator moves a subscription; suspending and terminating need a reason. */
export const statusChangeSchema = z.object({
  billingAccountId: z.uuid(),
  to: z.enum(subscriptionStatuses),
  reason: optionalText(500),
});

/** Activation: the first period starts that day (its end follows the billing period). */
export const activateSchema = z.object({
  billingAccountId: z.uuid(),
  startsOn: optionalDateText(),
});

export const pilotGoalSchema = z.object({ billingAccountId: z.uuid(), label: requiredText(200) });
export const pilotGoalIdSchema = z.object({ goalId: z.uuid(), done: z.boolean().optional() });
export const planIdSchema = z.object({ planId: z.uuid() });

export type AccountIdentityInput = z.output<typeof accountIdentitySchema>;
export type SubscriptionTermsInput = z.output<typeof subscriptionTermsSchema>;

/**
 * A provision (CLAUDE.console.md §8): a new client (its plan, program, pilot length) or, with
 * `billingAccountId`, another SARL of an existing client.
 */
export const provisionSchema = z.object({
  email: z.email("validation.email").trim().toLowerCase(),
  legalName: requiredText(200),
  billingAccountId: z.uuid().nullable(),
  planCode: optionalText(30),
  program: z.enum(subscriptionPrograms),
  pilotDays: optionalIntText(1, 365),
});
export const provisionIdSchema = z.object({ provisionId: z.uuid() });

/** A support session (CLAUDE.console.md §12): an organization, one of its staff, a reason. */
export const supportStartSchema = z.object({
  organizationId: z.uuid(),
  userId: z.uuid(),
  reason: requiredText(500),
});
