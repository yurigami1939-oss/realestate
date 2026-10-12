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
  moneyText,
  optionalDateText,
  optionalEmailText,
  optionalIntText,
  optionalMoneyText,
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
