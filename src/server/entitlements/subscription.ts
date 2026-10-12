import "server-only";

import { sql } from "drizzle-orm";

import { withTenant } from "@/db/tenant";
import type { CalendarDate } from "@/lib/dates";
import { type Module, moduleDeps, modules } from "@/lib/modules";
import {
  type AddonCode,
  addonModules,
  type BillingPeriod,
  type PlanLimits,
  type SubscriptionProgram,
  type SubscriptionStatus,
} from "@/lib/subscriptions";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { readAccess, type TenantAccess } from "./access";

/** The organization's subscription as the console shares it (`console.tenant_subscription()`). */
export type TenantSubscription = {
  status: SubscriptionStatus;
  program: SubscriptionProgram;
  billingPeriod: BillingPeriod;
  /** HT per period. */
  price: bigint;
  discountBp: number;
  priceLockedUntil: CalendarDate | null;
  pilotEndsOn: CalendarDate | null;
  currentPeriodStart: CalendarDate | null;
  currentPeriodEnd: CalendarDate | null;
  plan: { code: string; nameFr: string; nameAr: string; limits: PlanLimits; onQuote: boolean };
  addons: { code: AddonCode; price: bigint }[];
  organizations: { id: string; name: string }[];
};

type Raw = Omit<TenantSubscription, "price" | "addons" | "plan"> & {
  price: string;
  plan: TenantSubscription["plan"] & { modules: string[] };
  addons: { code: AddonCode; price: string }[];
};

/** A module on the subscription page: where it comes from, and whether it is on. */
export type ModuleRow = {
  module: Module;
  /** `plan`, `addon`, or null when the subscription does not include it. */
  source: "plan" | "addon" | null;
  on: boolean;
  /** Switched off by the gérant. */
  disabled: boolean;
  /** Prerequisites (online payment needs the portal). */
  needs: Module[];
};

/**
 * The subscription page (CLAUDE.console.md §11, `subscription:read`): the plan, its add-ons, the
 * account's organizations, and every module with where it comes from and its switch. Read
 * through the console's SECURITY DEFINER function — the app never reads console tables.
 */
export async function getTenantSubscription(ctx: TenantCtx): Promise<{
  subscription: TenantSubscription | null;
  access: TenantAccess;
  modules: ModuleRow[];
}> {
  assertCan(ctx, "subscription:read");
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.execute<{ data: Raw | null }>(
      sql`select console.tenant_subscription() as data`,
    );
    const access = await readAccess(tx);
    const raw = rows[0]?.data ?? null;
    const subscription: TenantSubscription | null = raw
      ? {
          ...raw,
          price: BigInt(raw.price),
          plan: {
            code: raw.plan.code,
            nameFr: raw.plan.nameFr,
            nameAr: raw.plan.nameAr,
            limits: raw.plan.limits,
            onQuote: raw.plan.onQuote,
          },
          addons: raw.addons.map((a) => ({ code: a.code, price: BigInt(a.price) })),
          organizations: raw.organizations ?? [],
        }
      : null;
    const fromAddons = new Set<Module>((raw?.addons ?? []).map((a) => addonModules[a.code]));
    const fromPlan = new Set(raw?.plan.modules ?? []);
    return {
      subscription,
      access,
      modules: modules.map((module) => ({
        module,
        source: fromPlan.has(module) ? "plan" : fromAddons.has(module) ? "addon" : null,
        on: access.modules.includes(module),
        disabled: access.disabled.includes(module),
        needs: [...(moduleDeps[module] ?? [])],
      })),
    };
  });
}
