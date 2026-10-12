import "server-only";

import { and, asc, count, eq, isNull, max } from "drizzle-orm";

import { consoleDb, type ConsoleTx } from "@/db/console-client";
import {
  accountOrganization,
  addon,
  billingAccount,
  pilotGoal,
  plan,
  subscription,
  subscriptionAddon,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import { type Module } from "@/lib/modules";
import { AppError } from "@/lib/result";
import { type AddonCode, addonModules, entitlementFor, type PlanLimits } from "@/lib/subscriptions";
import { moduleBlockers } from "@/server/entitlements/switches";

import { recordConsoleAudit } from "./audit";
import type { OperatorCtx } from "./context";
import { syncEntitlement } from "./entitlements";
import { changeSubscriptionStatus } from "./lifecycle";
import type { AccountIdentityInput, SubscriptionTermsInput } from "./schemas";

const priceFor = (row: { yearlyPrice: bigint; quarterlyPrice: bigint }, period: string) =>
  period === "yearly" ? row.yearlyPrice : row.quarterlyPrice;

/** The organizations of an account, oldest first. */
async function organizationsOf(tx: ConsoleTx, billingAccountId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: accountOrganization.organizationId })
    .from(accountOrganization)
    .where(eq(accountOrganization.billingAccountId, billingAccountId))
    .orderBy(asc(accountOrganization.addedAt));
  return rows.map((r) => r.id);
}

/**
 * Refuses taking modules away from an account while one of its organizations still uses them
 * (CLAUDE.console.md §5: the same rule as the gérant's switches). Read with the app role, each
 * organization in its own tenant.
 */
async function assertModulesFree(organizationIds: string[], lost: Module[]): Promise<void> {
  for (const organizationId of organizationIds) {
    for (const lostModule of lost) {
      const blockers = await withTenant({ orgId: organizationId }, (tx) =>
        moduleBlockers(tx, lostModule),
      );
      if (blockers > 0) {
        throw new AppError("CONFLICT", `subscription.blocked.${lostModule}`, {
          details: { count: blockers },
        });
      }
    }
  }
}

/** The modules an account's subscription entitles to, as it stands in the transaction. */
async function entitledModules(tx: ConsoleTx, subscriptionId: string, planModules: string[]) {
  const live = await tx
    .select({ code: subscriptionAddon.addonCode })
    .from(subscriptionAddon)
    .where(
      and(
        eq(subscriptionAddon.subscriptionId, subscriptionId),
        isNull(subscriptionAddon.removedOn),
      ),
    );
  return entitlementFor({
    planModules,
    addonModules: live.map((a) => addonModules[a.code]),
    limits: { activeUnits: null, organizations: null, storageGb: null },
    overrides: {},
  }).modules;
}

async function loadSubscription(tx: ConsoleTx, billingAccountId: string) {
  // The row is locked on its own: Postgres refuses a schema-qualified `FOR UPDATE OF`.
  const [locked] = await tx
    .select()
    .from(subscription)
    .where(eq(subscription.billingAccountId, billingAccountId))
    .for("update");
  if (!locked) throw new AppError("NOT_FOUND", "console.errors.accountUnknown");
  const [current] = await tx.select().from(plan).where(eq(plan.id, locked.planId));
  if (!current) throw new AppError("NOT_FOUND", "console.errors.planUnknown");
  return { subscription: locked, plan: current };
}

/** No price goes up while the founder price is locked (CLAUDE.console.md §11). */
function assertNoIncreaseWhileLocked(lockedUntil: string | null, before: bigint, after: bigint) {
  if (after > before && lockedUntil && lockedUntil >= todayInAlgiers()) {
    throw new AppError("CONFLICT", "console.errors.priceLocked", {
      details: { until: lockedUntil },
    });
  }
}

/** Corrects a client's invoicing identity and contact. Audited. */
export async function updateAccountIdentity(ctx: OperatorCtx, input: AccountIdentityInput) {
  await consoleDb.transaction(async (tx) => {
    const { billingAccountId, ...values } = input;
    const [before] = await tx
      .select()
      .from(billingAccount)
      .where(eq(billingAccount.id, billingAccountId));
    if (!before) throw new AppError("NOT_FOUND", "console.errors.accountUnknown");
    await tx.update(billingAccount).set(values).where(eq(billingAccount.id, billingAccountId));
    await recordConsoleAudit(tx, ctx, {
      action: "billing_account.update",
      billingAccountId,
      before,
      after: values,
    });
  });
}

/**
 * Changes a subscription's terms (CLAUDE.console.md §10): its plan (the account's organizations
 * within the new cap, no module still in use taken away), period, negotiated price and discount
 * (never up while the price is locked), price lock, pilot end, grace days and cap overrides; then
 * every organization's entitlement. Audited with before / after.
 */
export async function updateSubscriptionTerms(ctx: OperatorCtx, input: SubscriptionTermsInput) {
  await consoleDb.transaction(async (tx) => {
    const current = await loadSubscription(tx, input.billingAccountId);
    const [chosen] = await tx.select().from(plan).where(eq(plan.code, input.planCode));
    if (!chosen) throw new AppError("NOT_FOUND", "console.errors.planUnknown");
    if (chosen.archivedAt && chosen.id !== current.plan.id) {
      throw new AppError("CONFLICT", "console.errors.planArchived");
    }
    const discountBp = input.discount ?? 0;
    const net = (price: bigint, bp: number) => price - (price * BigInt(bp)) / 10_000n;
    assertNoIncreaseWhileLocked(
      current.subscription.priceLockedUntil,
      net(current.subscription.price, current.subscription.discountBp),
      net(input.price, discountBp),
    );

    const organizations = await organizationsOf(tx, input.billingAccountId);
    const overrides: Partial<PlanLimits> = {};
    if (input.activeUnits !== null) overrides.activeUnits = input.activeUnits;
    if (input.organizations !== null) overrides.organizations = input.organizations;
    if (input.storageGb !== null) overrides.storageGb = input.storageGb;
    const cap = { ...chosen.limits, ...overrides }.organizations;
    if (cap !== null && organizations.length > cap) {
      throw new AppError("CONFLICT", "console.errors.organizationsCap", { details: { cap } });
    }
    if (chosen.id !== current.plan.id) {
      const before = await entitledModules(tx, current.subscription.id, current.plan.modules);
      const after = await entitledModules(tx, current.subscription.id, chosen.modules);
      await assertModulesFree(
        organizations,
        before.filter((m) => !after.includes(m)),
      );
    }

    const values = {
      planId: chosen.id,
      billingPeriod: input.billingPeriod,
      price: input.price,
      discountBp,
      priceLockedUntil: input.priceLockedUntil,
      pilotEndsOn: input.pilotEndsOn,
      graceDays: input.graceDays,
      limitOverrides: overrides,
    };
    await tx.update(subscription).set(values).where(eq(subscription.id, current.subscription.id));
    await syncEntitlement(tx, input.billingAccountId);
    await recordConsoleAudit(tx, ctx, {
      action: "subscription.update",
      billingAccountId: input.billingAccountId,
      before: {
        plan: current.plan.code,
        billingPeriod: current.subscription.billingPeriod,
        price: current.subscription.price,
        discountBp: current.subscription.discountBp,
        priceLockedUntil: current.subscription.priceLockedUntil,
        pilotEndsOn: current.subscription.pilotEndsOn,
        graceDays: current.subscription.graceDays,
        limitOverrides: current.subscription.limitOverrides,
      },
      after: { ...values, plan: chosen.code, planId: undefined },
    });
  });
}

/**
 * Takes an add-on (at its negotiated price, else the catalog's for the period) or drops it —
 * never while an organization of the account still uses its module, unless the plan includes
 * it. Changing a live add-on's price never raises it while the price is locked. Audited.
 */
export async function setSubscriptionAddon(
  ctx: OperatorCtx,
  input: { billingAccountId: string; code: AddonCode; on: boolean; price: bigint | null },
) {
  await consoleDb.transaction(async (tx) => {
    const current = await loadSubscription(tx, input.billingAccountId);
    const [live] = await tx
      .select()
      .from(subscriptionAddon)
      .where(
        and(
          eq(subscriptionAddon.subscriptionId, current.subscription.id),
          eq(subscriptionAddon.addonCode, input.code),
          isNull(subscriptionAddon.removedOn),
        ),
      );
    const today = todayInAlgiers();
    if (input.on) {
      const [catalog] = await tx
        .select()
        .from(addon)
        .where(and(eq(addon.code, input.code), isNull(addon.archivedAt)));
      if (!catalog) throw new AppError("NOT_FOUND", "console.errors.addonUnknown");
      const price = input.price ?? priceFor(catalog, current.subscription.billingPeriod);
      if (live) {
        if (live.price === price) return;
        assertNoIncreaseWhileLocked(current.subscription.priceLockedUntil, live.price, price);
        await tx
          .update(subscriptionAddon)
          .set({ removedOn: today })
          .where(eq(subscriptionAddon.id, live.id));
      }
      await tx.insert(subscriptionAddon).values({
        subscriptionId: current.subscription.id,
        addonCode: input.code,
        price,
        addedOn: today,
      });
      await recordConsoleAudit(tx, ctx, {
        action: "subscription.addon",
        billingAccountId: input.billingAccountId,
        before: live ? { code: input.code, price: live.price } : null,
        after: { code: input.code, price },
      });
    } else {
      if (!live) return;
      const addonModule = addonModules[input.code];
      if (!current.plan.modules.includes(addonModule)) {
        await assertModulesFree(await organizationsOf(tx, input.billingAccountId), [addonModule]);
      }
      await tx
        .update(subscriptionAddon)
        .set({ removedOn: today })
        .where(eq(subscriptionAddon.id, live.id));
      await recordConsoleAudit(tx, ctx, {
        action: "subscription.addon",
        billingAccountId: input.billingAccountId,
        before: { code: input.code, price: live.price },
        after: null,
      });
    }
    await syncEntitlement(tx, input.billingAccountId);
  });
}

/**
 * The client chose its plan (CLAUDE.console.md §2): the subscription becomes active and its
 * first period starts (a year or a quarter, by its billing period).
 */
export async function activateSubscription(
  ctx: OperatorCtx,
  input: { billingAccountId: string; startsOn: string | null },
) {
  await consoleDb.transaction(async (tx) => {
    const current = await loadSubscription(tx, input.billingAccountId);
    const start = input.startsOn ?? todayInAlgiers();
    const months = current.subscription.billingPeriod === "yearly" ? 12 : 3;
    await tx
      .update(subscription)
      .set({ currentPeriodStart: start, currentPeriodEnd: addDays(addMonths(start, months), -1) })
      .where(eq(subscription.id, current.subscription.id));
    await changeSubscriptionStatus(
      ctx,
      { billingAccountId: input.billingAccountId, to: "active" },
      tx,
    );
    await syncEntitlement(tx, input.billingAccountId);
  });
}

/** A goal agreed with a piloting client (CLAUDE.console.md §10), last in its list. */
export async function addPilotGoal(
  ctx: OperatorCtx,
  input: { billingAccountId: string; label: string },
) {
  await consoleDb.transaction(async (tx) => {
    const current = await loadSubscription(tx, input.billingAccountId);
    const [last] = await tx
      .select({ n: max(pilotGoal.position) })
      .from(pilotGoal)
      .where(eq(pilotGoal.subscriptionId, current.subscription.id));
    await tx.insert(pilotGoal).values({
      subscriptionId: current.subscription.id,
      position: (last?.n ?? 0) + 1,
      label: input.label,
    });
    await recordConsoleAudit(tx, ctx, {
      action: "pilot_goal.create",
      billingAccountId: input.billingAccountId,
      after: { label: input.label },
    });
  });
}

/** Ticks a pilot goal (done today) or unticks it; or deletes it. Audited. */
export async function updatePilotGoal(
  ctx: OperatorCtx,
  input: { goalId: string; done?: boolean; remove?: boolean },
) {
  await consoleDb.transaction(async (tx) => {
    const [goal] = await tx
      .select({ goal: pilotGoal, billingAccountId: subscription.billingAccountId })
      .from(pilotGoal)
      .innerJoin(subscription, eq(subscription.id, pilotGoal.subscriptionId))
      .where(eq(pilotGoal.id, input.goalId));
    if (!goal) throw new AppError("NOT_FOUND");
    if (input.remove) {
      await tx.delete(pilotGoal).where(eq(pilotGoal.id, input.goalId));
    } else {
      await tx
        .update(pilotGoal)
        .set({ doneOn: input.done ? todayInAlgiers() : null })
        .where(eq(pilotGoal.id, input.goalId));
    }
    await recordConsoleAudit(tx, ctx, {
      action: input.remove ? "pilot_goal.delete" : "pilot_goal.update",
      billingAccountId: goal.billingAccountId,
      before: { label: goal.goal.label, doneOn: goal.goal.doneOn },
      after: input.remove ? null : { done: input.done === true },
    });
  });
}

/** Archives a plan: no new subscription takes it, those on it keep it. */
export async function archivePlan(ctx: OperatorCtx, planId: string) {
  await consoleDb.transaction(async (tx) => {
    const [found] = await tx.select().from(plan).where(eq(plan.id, planId));
    if (!found) throw new AppError("NOT_FOUND", "console.errors.planUnknown");
    if (found.archivedAt) return;
    await tx.update(plan).set({ archivedAt: new Date() }).where(eq(plan.id, planId));
    await recordConsoleAudit(tx, ctx, { action: "plan.archive", after: { code: found.code } });
  });
}

/**
 * A new price for an add-on of the catalog: the live row is archived and a new one made (rows in
 * use are never edited); subscriptions keep the price they took.
 */
export async function repriceAddon(
  ctx: OperatorCtx,
  input: { code: AddonCode; yearlyPrice: bigint; quarterlyPrice: bigint },
) {
  await consoleDb.transaction(async (tx) => {
    const [live] = await tx
      .select()
      .from(addon)
      .where(and(eq(addon.code, input.code), isNull(addon.archivedAt)));
    if (!live) throw new AppError("NOT_FOUND", "console.errors.addonUnknown");
    await tx.update(addon).set({ archivedAt: new Date() }).where(eq(addon.id, live.id));
    await tx.insert(addon).values({
      code: input.code,
      basis: live.basis,
      yearlyPrice: input.yearlyPrice,
      quarterlyPrice: input.quarterlyPrice,
    });
    await recordConsoleAudit(tx, ctx, {
      action: "addon.reprice",
      before: {
        code: input.code,
        yearlyPrice: live.yearlyPrice,
        quarterlyPrice: live.quarterlyPrice,
      },
      after: input,
    });
  });
}

/** How many subscriptions use each plan (a plan in use is never edited, §3). */
export async function planUsage(): Promise<Map<string, number>> {
  const rows = await consoleDb
    .select({ planId: subscription.planId, n: count() })
    .from(subscription)
    .groupBy(subscription.planId);
  return new Map(rows.map((r) => [r.planId, r.n]));
}
