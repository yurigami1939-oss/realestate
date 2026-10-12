import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import type { ConsoleTx } from "@/db/console-client";
import { setConsoleTenant } from "@/db/console-tenant";
import {
  accountOrganization,
  plan,
  subscription,
  subscriptionAddon,
  tenantEntitlement,
} from "@/db/schema";
import {
  addonModules,
  type Entitlement,
  entitlementFor,
  type SubscriptionStatus,
} from "@/lib/subscriptions";

export type SyncedEntitlement = Entitlement & {
  status: SubscriptionStatus;
  organizationIds: string[];
};

/**
 * Mirrors a billing account's subscription into the `tenant_entitlement` row of each of its
 * organizations (CLAUDE.console.md §3): state, modules (plan + live add-ons), caps (plan +
 * overrides), pilot end, period end. Called in the console transaction that changed the
 * subscription, its add-ons or the account's organizations. Null when the account has no
 * subscription (its organizations keep no entitlement: read-only, fail closed).
 */
export async function syncEntitlement(
  tx: ConsoleTx,
  billingAccountId: string,
): Promise<SyncedEntitlement | null> {
  const [current] = await tx
    .select({
      id: subscription.id,
      status: subscription.status,
      pilotEndsOn: subscription.pilotEndsOn,
      currentPeriodEnd: subscription.currentPeriodEnd,
      overrides: subscription.limitOverrides,
      planModules: plan.modules,
      limits: plan.limits,
    })
    .from(subscription)
    .innerJoin(plan, eq(plan.id, subscription.planId))
    .where(eq(subscription.billingAccountId, billingAccountId));
  if (!current) return null;

  const addons = await tx
    .select({ code: subscriptionAddon.addonCode })
    .from(subscriptionAddon)
    .where(
      and(eq(subscriptionAddon.subscriptionId, current.id), isNull(subscriptionAddon.removedOn)),
    );
  const entitlement = entitlementFor({
    planModules: current.planModules,
    addonModules: addons.map((a) => addonModules[a.code]),
    limits: current.limits,
    overrides: current.overrides,
  });

  const organizations = await tx
    .select({ id: accountOrganization.organizationId })
    .from(accountOrganization)
    .where(eq(accountOrganization.billingAccountId, billingAccountId))
    .orderBy(accountOrganization.addedAt);
  const row = {
    status: current.status,
    modules: entitlement.modules,
    limits: entitlement.limits,
    pilotEndsOn: current.pilotEndsOn,
    currentPeriodEnd: current.currentPeriodEnd,
  };
  for (const { id } of organizations) {
    await setConsoleTenant(tx, id);
    await tx
      .insert(tenantEntitlement)
      .values({ organizationId: id, ...row })
      .onConflictDoUpdate({
        target: tenantEntitlement.organizationId,
        set: { ...row, updatedAt: new Date() },
      });
  }
  return {
    ...entitlement,
    status: current.status,
    organizationIds: organizations.map((o) => o.id),
  };
}
