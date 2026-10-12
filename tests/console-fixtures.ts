import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { consoleDb } from "@/db/console-client";
import { addon, plan } from "@/db/schema";
import { modules } from "@/lib/modules";
import { addonCodes } from "@/lib/subscriptions";
import { openBillingAccount } from "@/server/console/accounts";
import { systemOperator } from "@/server/console/context";
import { createAddon, createPlan } from "@/server/console/plans";
import { addonSchema, openAccountSchema, planSchema } from "@/server/console/schemas";

/** A plan of its own per test (plans are not tenant data: the test database keeps them all). */
export async function createTestPlan(
  values: Partial<Record<keyof typeof planSchema.shape, unknown>> = {},
) {
  const code = `t-${randomUUID().slice(0, 8)}`;
  const parsed = planSchema.parse({
    code,
    nameFr: `Formule ${code}`,
    nameAr: `صيغة ${code}`,
    yearlyPrice: "900000",
    quarterlyPrice: "270000",
    setupFee: "250000",
    modules: ["imports", "treasury", "portal"],
    activeUnits: "300",
    organizations: "2",
    storageGb: "100",
    onQuote: false,
    ...values,
  });
  await createPlan(systemOperator, parsed);
  return parsed.code;
}

/** The four add-ons of the catalog, created once in the test database. */
export async function ensureCatalogAddons(): Promise<void> {
  for (const code of addonCodes) {
    const [live] = await consoleDb
      .select({ id: addon.id })
      .from(addon)
      .where(and(eq(addon.code, code), isNull(addon.archivedAt)));
    if (live) continue;
    await createAddon(
      systemOperator,
      addonSchema.parse({
        code,
        basis: code === "syndic" ? "per_managed_lot" : "flat",
        yearlyPrice: code === "syndic" ? "300" : "100000",
        quarterlyPrice: code === "syndic" ? "300" : "30000",
      }),
    ).catch(async (error: unknown) => {
      // Another test file may have created it meanwhile.
      const [now] = await consoleDb
        .select({ id: addon.id })
        .from(addon)
        .where(and(eq(addon.code, code), isNull(addon.archivedAt)));
      if (!now) throw error;
    });
  }
}

/** A client account for these organizations on a fresh plan (active, yearly) unless told otherwise. */
export async function openTestAccount(
  organizationIds: string[],
  values: Partial<Record<keyof typeof openAccountSchema.shape, unknown>> = {},
) {
  const planCode = typeof values.planCode === "string" ? values.planCode : await createTestPlan();
  return openBillingAccount(
    systemOperator,
    openAccountSchema.parse({
      organizationIds,
      planCode,
      status: "active",
      program: "standard",
      billingPeriod: "yearly",
      addons: [],
      ...values,
    }),
  );
}

/** Every module, no cap: the plan of the organizations the factories create. */
const ALL_MODULES_PLAN = "test-all-modules";

async function ensureAllModulesPlan(): Promise<void> {
  const [found] = await consoleDb
    .select({ id: plan.id })
    .from(plan)
    .where(eq(plan.code, ALL_MODULES_PLAN));
  if (found) return;
  await createTestPlan({
    code: ALL_MODULES_PLAN,
    modules: [...modules],
    activeUnits: "",
    organizations: "",
    storageGb: "",
  }).catch(async (error: unknown) => {
    // Another test file may have created it meanwhile.
    const [now] = await consoleDb
      .select({ id: plan.id })
      .from(plan)
      .where(eq(plan.code, ALL_MODULES_PLAN));
    if (!now) throw error;
  });
}

/**
 * Entitles a test organization to every module (its own account, active): side effects that
 * follow the modules (WhatsApp, occupants, treasury accounts) work as before the console.
 */
export async function entitleForTests(organizationId: string): Promise<void> {
  await ensureAllModulesPlan();
  await openTestAccount([organizationId], { planCode: ALL_MODULES_PLAN });
}
