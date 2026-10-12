import { isModule, type Module, modules } from "./modules";

/**
 * Subscriptions sold by the operator (CLAUDE.console.md §2, §6): one per billing account (a
 * client's SARLs together), a plan, add-ons, a state.
 */
export const subscriptionStatuses = [
  "pilot",
  "active",
  "past_due",
  "suspended",
  "terminated",
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

/**
 * Where a subscription may go (CLAUDE.console.md §6): `past_due` and back to `active` by the
 * daily job (a pilot over, an invoice overdue, then paid), the rest by the operator — never an
 * automatic suspension.
 */
export const subscriptionTransitions: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  pilot: ["active", "past_due", "suspended", "terminated"],
  active: ["past_due", "suspended", "terminated"],
  past_due: ["active", "suspended", "terminated"],
  suspended: ["active", "terminated"],
  terminated: ["suspended"],
};

export const canTransition = (from: SubscriptionStatus, to: SubscriptionStatus): boolean =>
  subscriptionTransitions[from].includes(to);

/** A suspended or terminated organization is read-only; so is one without a subscription. */
export const isWritable = (status: SubscriptionStatus | null): boolean =>
  status !== null && status !== "suspended" && status !== "terminated";

/** Design partners: the first clients, a long free pilot then a founder price locked. */
export const subscriptionPrograms = ["standard", "design_partner"] as const;
export type SubscriptionProgram = (typeof subscriptionPrograms)[number];

/** Yearly by default (about two months free), quarterly as a fallback; never monthly. */
export const billingPeriods = ["yearly", "quarterly"] as const;
export type BillingPeriod = (typeof billingPeriods)[number];

/** Add-ons sold on top of a plan, each switching on one module. */
export const addonCodes = ["syndic", "rentals", "whatsapp", "online_payment"] as const;
export type AddonCode = (typeof addonCodes)[number];

export const addonModules: Record<AddonCode, Module> = {
  syndic: "syndic",
  rentals: "rentals",
  whatsapp: "whatsapp",
  online_payment: "online_payment",
};

/** `flat`: a price per period; `per_managed_lot`: a price per managed lot and month (syndic). */
export const addonBases = ["flat", "per_managed_lot"] as const;
export type AddonBasis = (typeof addonBases)[number];

/** A plan's caps; null = unlimited. Users and projects are never capped (§2). */
export type PlanLimits = {
  /** Live units not handed over, in projects not delivered, pooled over the account. */
  activeUnits: number | null;
  /** Organizations (SARLs) of the billing account. */
  organizations: number | null;
  /** Stored files, in GB (soft: a banner, never a refusal). */
  storageGb: number | null;
};

export const unlimited: PlanLimits = { activeUnits: null, organizations: null, storageGb: null };

/** What a subscription entitles each organization of its account to (`tenant_entitlement`). */
export type Entitlement = { modules: Module[]; limits: PlanLimits };

/**
 * The entitlement of a subscription: the plan's modules and those of its live add-ons (known
 * modules only, in catalog order), the plan's caps with the subscription's overrides.
 */
export function entitlementFor(input: {
  planModules: readonly string[];
  addonModules: readonly string[];
  limits: PlanLimits;
  overrides: Partial<PlanLimits>;
}): Entitlement {
  const granted = new Set([...input.planModules, ...input.addonModules].filter(isModule));
  return {
    modules: modules.filter((m) => granted.has(m)),
    limits: { ...input.limits, ...input.overrides },
  };
}
