import "server-only";

import { and, count, eq, inArray, isNull } from "drizzle-orm";

import { consoleDb, type ConsoleTx } from "@/db/console-client";
import {
  accountOrganization,
  addon,
  billingAccount,
  organization,
  plan,
  subscription,
  subscriptionAddon,
} from "@/db/schema";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import type { BillingPeriod, PlanLimits } from "@/lib/subscriptions";

import { recordConsoleAudit } from "./audit";
import type { OperatorCtx } from "./context";
import { syncEntitlement } from "./entitlements";
import type { OpenAccountInput } from "./schemas";

/** Pilot length when none is given (CLAUDE.console.md §18, proposed figures). */
export const PILOT_DAYS = { standard: 30, design_partner: 90 } as const;

const priceFor = (row: { yearlyPrice: bigint; quarterlyPrice: bigint }, period: BillingPeriod) =>
  period === "yearly" ? row.yearlyPrice : row.quarterlyPrice;

/** The plan's caps with the subscription's overrides. */
const capsOf = (limits: PlanLimits, overrides: Partial<PlanLimits>): PlanLimits => ({
  ...limits,
  ...overrides,
});

/**
 * Opens a client (CLAUDE.console.md §8): its billing account (identity from its first
 * organization unless given), its organizations, its subscription with the add-ons taken (prices
 * from the catalog unless negotiated), then every organization's entitlement — one console
 * transaction, audited.
 */
export async function openBillingAccount(
  ctx: OperatorCtx,
  input: OpenAccountInput,
  tx?: ConsoleTx,
): Promise<{ billingAccountId: string; subscriptionId: string }> {
  const run = async (trx: ConsoleTx) => {
    const [chosen] = await trx
      .select()
      .from(plan)
      .where(and(eq(plan.code, input.planCode), isNull(plan.archivedAt)));
    if (!chosen) throw new AppError("NOT_FOUND", "console.errors.planUnknown");

    const organizationIds = [...new Set(input.organizationIds)];
    const cap = chosen.limits.organizations;
    if (cap !== null && organizationIds.length > cap) {
      throw new AppError("CONFLICT", "console.errors.organizationsCap", { details: { cap } });
    }
    const organizations = await trx
      .select()
      .from(organization)
      .where(inArray(organization.id, organizationIds));
    if (organizations.length !== organizationIds.length) {
      throw new AppError("NOT_FOUND", "console.errors.organizationUnknown");
    }
    const attached = await trx
      .select({ id: accountOrganization.organizationId })
      .from(accountOrganization)
      .where(inArray(accountOrganization.organizationId, organizationIds));
    if (attached.length > 0) throw new AppError("CONFLICT", "console.errors.alreadyAttached");

    const first = organizations.find((o) => o.id === organizationIds[0]);
    if (!first) throw new Error("openBillingAccount: first organization missing");
    const [account] = await trx
      .insert(billingAccount)
      .values({
        legalName: input.legalName ?? first.legalName ?? first.name,
        address: first.address,
        wilaya: first.wilaya,
        rcNumber: first.rcNumber,
        nif: first.nif,
        nis: first.nis,
        aiNumber: first.aiNumber,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone ?? first.phone,
        notes: input.notes,
      })
      .returning({ id: billingAccount.id, legalName: billingAccount.legalName });
    if (!account) throw new Error("openBillingAccount: no account row");
    await trx
      .insert(accountOrganization)
      .values(organizationIds.map((id) => ({ organizationId: id, billingAccountId: account.id })));

    const today = todayInAlgiers();
    const pilotEndsOn =
      input.pilotEndsOn ??
      (input.status === "pilot" ? addDays(today, PILOT_DAYS[input.program]) : null);
    const [created] = await trx
      .insert(subscription)
      .values({
        billingAccountId: account.id,
        planId: chosen.id,
        status: input.status,
        program: input.program,
        activatedAt: input.status === "pilot" ? null : new Date(),
        pilotEndsOn,
        billingPeriod: input.billingPeriod,
        price: input.price ?? priceFor(chosen, input.billingPeriod),
        priceLockedUntil: input.priceLockedUntil,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
      })
      .returning({ id: subscription.id, price: subscription.price });
    if (!created) throw new Error("openBillingAccount: no subscription row");

    const addons = [];
    for (const taken of input.addons) {
      const [catalog] = await trx
        .select()
        .from(addon)
        .where(and(eq(addon.code, taken.code), isNull(addon.archivedAt)));
      if (!catalog) throw new AppError("NOT_FOUND", "console.errors.addonUnknown");
      addons.push({
        subscriptionId: created.id,
        addonCode: taken.code,
        price: taken.price ?? priceFor(catalog, input.billingPeriod),
        addedOn: today,
      });
    }
    if (addons.length > 0) await trx.insert(subscriptionAddon).values(addons);

    await syncEntitlement(trx, account.id);
    await recordConsoleAudit(trx, ctx, {
      action: "billing_account.open",
      billingAccountId: account.id,
      after: {
        legalName: account.legalName,
        organizationIds,
        plan: chosen.code,
        status: input.status,
        program: input.program,
        billingPeriod: input.billingPeriod,
        price: created.price,
        pilotEndsOn,
        addons: addons.map((a) => ({ code: a.addonCode, price: a.price })),
      },
    });
    return { billingAccountId: account.id, subscriptionId: created.id };
  };
  return tx ? run(tx) : consoleDb.transaction(run);
}

/**
 * Adds an organization (another SARL of the client) to a billing account within its plan's
 * `organizations` cap; it gets the account's entitlement at once.
 */
export async function attachOrganization(
  ctx: OperatorCtx,
  input: { billingAccountId: string; organizationId: string },
  tx?: ConsoleTx,
): Promise<void> {
  const run = async (trx: ConsoleTx) => {
    const [current] = await trx
      .select({ limits: plan.limits, overrides: subscription.limitOverrides })
      .from(subscription)
      .innerJoin(plan, eq(plan.id, subscription.planId))
      .where(eq(subscription.billingAccountId, input.billingAccountId));
    if (!current) throw new AppError("NOT_FOUND", "console.errors.accountUnknown");
    const [attached] = await trx
      .select({ id: accountOrganization.id })
      .from(accountOrganization)
      .where(eq(accountOrganization.organizationId, input.organizationId));
    if (attached) throw new AppError("CONFLICT", "console.errors.alreadyAttached");
    const [org] = await trx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId));
    if (!org) throw new AppError("NOT_FOUND", "console.errors.organizationUnknown");

    const cap = capsOf(current.limits, current.overrides).organizations;
    const [held] = await trx
      .select({ n: count() })
      .from(accountOrganization)
      .where(eq(accountOrganization.billingAccountId, input.billingAccountId));
    if (cap !== null && (held?.n ?? 0) + 1 > cap) {
      throw new AppError("CONFLICT", "console.errors.organizationsCap", { details: { cap } });
    }

    await trx.insert(accountOrganization).values(input);
    await syncEntitlement(trx, input.billingAccountId);
    await recordConsoleAudit(trx, ctx, {
      action: "billing_account.attach",
      billingAccountId: input.billingAccountId,
      organizationId: input.organizationId,
    });
  };
  return tx ? run(tx) : consoleDb.transaction(run);
}
