/**
 * The operator's side of the demo (CLAUDE.console.md §15): the catalog — three plans and four
 * add-ons at **placeholder prices** (the real ones are the operator's to set, §18) — and the
 * demo gérant's client account: both SARLs on Promoteur with every add-on, active, billed
 * yearly, the current period started three months ago (relative to today, like the rest of the
 * seed).
 */
import { eq } from "drizzle-orm";

import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import { attachOrganization, openBillingAccount } from "@/server/console/accounts";
import { systemOperator } from "@/server/console/context";
import { createAddon, createPlan } from "@/server/console/plans";
import { addonSchema, openAccountSchema, planSchema } from "@/server/console/schemas";

import { consoleDb } from "../console-client";
import { withConsoleTenant } from "../console-tenant";
import { organization, tenantEntitlement } from "../schema";

const corePlus = ["imports"] as const;
const promoteurModules = [
  ...corePlus,
  "construction",
  "costs",
  "treasury",
  "reports",
  "portal",
  "lead_capture",
] as const;

/** Placeholder prices, HT in dinars (CLAUDE.console.md §18: to be set by the operator). */
const plans = [
  {
    code: "essentiel",
    nameFr: "Essentiel",
    nameAr: "الأساسية",
    yearlyPrice: "400000",
    quarterlyPrice: "120000",
    setupFee: "150000",
    modules: [...corePlus],
    activeUnits: "100",
    organizations: "1",
    storageGb: "20",
    onQuote: false,
  },
  {
    code: "promoteur",
    nameFr: "Promoteur",
    nameAr: "المرقّي",
    yearlyPrice: "900000",
    quarterlyPrice: "270000",
    setupFee: "250000",
    modules: [...promoteurModules],
    activeUnits: "300",
    organizations: "2",
    storageGb: "100",
    onQuote: false,
  },
  {
    code: "groupe",
    nameFr: "Groupe",
    nameAr: "المجموعة",
    yearlyPrice: "0",
    quarterlyPrice: "0",
    setupFee: "0",
    modules: [...promoteurModules],
    activeUnits: "",
    organizations: "",
    storageGb: "",
    onQuote: true,
  },
];

const addons = [
  { code: "syndic", basis: "per_managed_lot", yearlyPrice: "300", quarterlyPrice: "300" },
  { code: "rentals", basis: "flat", yearlyPrice: "120000", quarterlyPrice: "36000" },
  { code: "whatsapp", basis: "flat", yearlyPrice: "60000", quarterlyPrice: "18000" },
  { code: "online_payment", basis: "flat", yearlyPrice: "100000", quarterlyPrice: "30000" },
];

/** Plans and add-ons, before any organization: every organization is entitled at creation. */
export async function seedConsoleCatalog(): Promise<void> {
  await consoleDb.transaction(async (tx) => {
    for (const p of plans) await createPlan(systemOperator, planSchema.parse(p), tx);
    for (const a of addons) await createAddon(systemOperator, addonSchema.parse(a), tx);
  });
}

/** The demo gérant's client account, opened with its first SARL; returns the account. */
export async function openDemoAccount(organizationId: string): Promise<string> {
  const start = addMonths(todayInAlgiers(), -3);
  const { billingAccountId } = await openBillingAccount(
    systemOperator,
    openAccountSchema.parse({
      legalName: "",
      contactName: "Karim Benali",
      email: "gerant@demo.test",
      organizationIds: [organizationId],
      planCode: "promoteur",
      status: "active",
      program: "standard",
      billingPeriod: "yearly",
      currentPeriodStart: start,
      currentPeriodEnd: addDays(addMonths(start, 12), -1),
      addons: ["syndic", "rentals", "whatsapp", "online_payment"].map((code) => ({ code })),
    }),
  );
  return billingAccountId;
}

/** Another SARL of the same client joins its account (and entitlement). */
export async function attachToDemoAccount(
  billingAccountId: string,
  organizationId: string,
): Promise<void> {
  await attachOrganization(systemOperator, { billingAccountId, organizationId });
}

/** Fail closed (CLAUDE.console.md §3): the seed refuses to finish with an organization unentitled. */
export async function assertEveryOrganizationEntitled(): Promise<void> {
  const organizations = await consoleDb
    .select({ id: organization.id, name: organization.name })
    .from(organization);
  for (const org of organizations) {
    const [row] = await withConsoleTenant(org.id, (tx) =>
      tx
        .select({ status: tenantEntitlement.status })
        .from(tenantEntitlement)
        .where(eq(tenantEntitlement.organizationId, org.id)),
    );
    if (!row) throw new Error(`seed: organization ${org.name} has no entitlement`);
  }
}
