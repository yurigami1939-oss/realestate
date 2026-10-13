import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { consoleDb } from "@/db/console-client";
import {
  accountOrganization,
  addon,
  billingAccount,
  consoleAuditLog,
  organization,
  pilotGoal,
  plan,
  provision,
  subscription,
  subscriptionAddon,
  tenantUsage,
  user,
} from "@/db/schema";
import { addDays, todayInAlgiers } from "@/lib/dates";
import {
  type SubscriptionProgram,
  type SubscriptionStatus,
  subscriptionStatuses,
} from "@/lib/subscriptions";
import { loadTenantAccess } from "@/server/entitlements/access";

import { listSupportMembers } from "./support";

import type { OperatorCtx } from "./context";

/**
 * The console's home (CLAUDE.console.md §10): accounts by state and the to-dos — pilots ending
 * within a week, pilots over beyond their grace (to suspend or activate), organizations without
 * a client account (read-only until attached).
 */
export async function getConsoleOverview(_ctx: OperatorCtx) {
  const today = todayInAlgiers();
  const byStatus = await consoleDb
    .select({ status: subscription.status, n: count() })
    .from(subscription)
    .groupBy(subscription.status);
  const counts = Object.fromEntries(subscriptionStatuses.map((s) => [s, 0])) as Record<
    SubscriptionStatus,
    number
  >;
  for (const row of byStatus) counts[row.status] = row.n;

  const account = {
    id: billingAccount.id,
    legalName: billingAccount.legalName,
    pilotEndsOn: subscription.pilotEndsOn,
    graceDays: subscription.graceDays,
  };
  const pilotsEnding = await consoleDb
    .select(account)
    .from(subscription)
    .innerJoin(billingAccount, eq(billingAccount.id, subscription.billingAccountId))
    .where(and(eq(subscription.status, "pilot"), lte(subscription.pilotEndsOn, addDays(today, 7))))
    .orderBy(asc(subscription.pilotEndsOn));
  const beyondGrace = await consoleDb
    .select(account)
    .from(subscription)
    .innerJoin(billingAccount, eq(billingAccount.id, subscription.billingAccountId))
    .where(
      and(
        eq(subscription.status, "past_due"),
        isNull(subscription.activatedAt),
        sql`${subscription.pilotEndsOn} + ${subscription.graceDays} < ${today}::date`,
      ),
    )
    .orderBy(asc(subscription.pilotEndsOn));
  const held = consoleDb
    .select({ id: accountOrganization.organizationId })
    .from(accountOrganization);
  const unentitled = await consoleDb
    .select({ id: organization.id, name: organization.name, createdAt: organization.createdAt })
    .from(organization)
    .where(notInArray(organization.id, held))
    .orderBy(desc(organization.createdAt))
    .limit(50);
  const provisionsWaiting = await consoleDb
    .select({ id: provision.id, legalName: provision.legalName, createdAt: provision.createdAt })
    .from(provision)
    .where(
      and(
        isNull(provision.usedAt),
        isNull(provision.revokedAt),
        sql`${provision.expiresAt} > now()`,
        sql`${provision.createdAt} < now() - interval '7 days'`,
      ),
    )
    .orderBy(asc(provision.createdAt));
  // Accounts beyond their caps, as last measured: active units (propose the next plan) and storage.
  const { rows: overCap } = await consoleDb.execute<{
    id: string;
    legalName: string;
    activeUnits: number;
    unitsCap: number | null;
    storageBytes: number;
    storageGb: number | null;
  }>(sql`
    select b.id, b.legal_name as "legalName",
      coalesce(sum(u.active_units), 0)::int as "activeUnits",
      ((p.limits || coalesce(s.limit_overrides, '{}'::jsonb)) ->> 'activeUnits')::int as "unitsCap",
      coalesce(sum(u.storage_bytes), 0)::float8 as "storageBytes",
      ((p.limits || coalesce(s.limit_overrides, '{}'::jsonb)) ->> 'storageGb')::int as "storageGb"
    from console.billing_account b
    join console.subscription s on s.billing_account_id = b.id
    join console.plan p on p.id = s.plan_id
    join console.account_organization ao on ao.billing_account_id = b.id
    left join lateral (
      select t.active_units, t.storage_bytes from console.tenant_usage t
      where t.organization_id = ao.organization_id order by t.measured_on desc limit 1
    ) u on true
    where s.status <> 'terminated'
    group by b.id, b.legal_name, s.limit_overrides, p.limits`);
  const overUnits = overCap.filter((a) => a.unitsCap !== null && a.activeUnits > a.unitsCap);
  const overStorage = overCap.filter(
    (a) => a.storageGb !== null && a.storageBytes > a.storageGb * 1e9,
  );
  return {
    counts,
    pilotsEnding,
    beyondGrace,
    unentitled,
    provisionsWaiting,
    overUnits,
    overStorage,
  };
}

/** An organization's last usage snapshot (CLAUDE.console.md §7). */
export type UsageRow = typeof tenantUsage.$inferSelect;

export type AccountFilters = {
  q?: string;
  status?: SubscriptionStatus;
  plan?: string;
  program?: SubscriptionProgram;
};

/** The client accounts, searched by name (the account's or one of its companies'), filtered. */
export async function listAccounts(_ctx: OperatorCtx, filters: AccountFilters) {
  const q = filters.q?.trim();
  const companies = sql<string>`coalesce((
    select string_agg(o.name, ' · ' order by ao.added_at)
    from console.account_organization ao join public.organization o on o.id = ao.organization_id
    where ao.billing_account_id = ${billingAccount.id}), '')`;
  const rows = await consoleDb
    .select({
      id: billingAccount.id,
      legalName: billingAccount.legalName,
      companies,
      status: subscription.status,
      program: subscription.program,
      planCode: plan.code,
      planNameFr: plan.nameFr,
      planNameAr: plan.nameAr,
      pilotEndsOn: subscription.pilotEndsOn,
      currentPeriodEnd: subscription.currentPeriodEnd,
    })
    .from(billingAccount)
    .innerJoin(subscription, eq(subscription.billingAccountId, billingAccount.id))
    .innerJoin(plan, eq(plan.id, subscription.planId))
    .where(
      and(
        q
          ? or(
              ilike(billingAccount.legalName, `%${q}%`),
              sql`exists (select 1 from console.account_organization ao
                  join public.organization o on o.id = ao.organization_id
                  where ao.billing_account_id = ${billingAccount.id} and o.name ilike ${`%${q}%`})`,
            )
          : undefined,
        filters.status ? eq(subscription.status, filters.status) : undefined,
        filters.plan ? eq(plan.code, filters.plan) : undefined,
        filters.program ? eq(subscription.program, filters.program) : undefined,
      ),
    )
    .orderBy(asc(billingAccount.legalName))
    .limit(200);
  return rows;
}

/**
 * A client account (CLAUDE.console.md §10): identity, subscription with its plan, add-ons (live
 * and past), organizations with their gérants and modules (as each sees them: entitled, switched
 * off), pilot goals, the console's trail.
 */
export async function getAccount(_ctx: OperatorCtx, billingAccountId: string) {
  const [row] = await consoleDb
    .select({ account: billingAccount, subscription, plan })
    .from(billingAccount)
    .innerJoin(subscription, eq(subscription.billingAccountId, billingAccount.id))
    .innerJoin(plan, eq(plan.id, subscription.planId))
    .where(eq(billingAccount.id, billingAccountId));
  if (!row) return null;
  const addons = await consoleDb
    .select()
    .from(subscriptionAddon)
    .where(eq(subscriptionAddon.subscriptionId, row.subscription.id))
    .orderBy(desc(subscriptionAddon.addedOn), desc(subscriptionAddon.createdAt));
  const organizations = await consoleDb
    .select({ id: organization.id, name: organization.name, addedAt: accountOrganization.addedAt })
    .from(accountOrganization)
    .innerJoin(organization, eq(organization.id, accountOrganization.organizationId))
    .where(eq(accountOrganization.billingAccountId, billingAccountId))
    .orderBy(asc(accountOrganization.addedAt));
  const ids = organizations.map((o) => o.id);
  // Staff only (support sessions never view a portal account), the gérants first.
  const staff = await listSupportMembers(ids);
  const withAccess = [];
  for (const org of organizations) {
    const access = await loadTenantAccess(org.id);
    withAccess.push({
      ...org,
      owners: staff.filter((m) => m.organizationId === org.id && m.roles.includes("owner")),
      members: staff.filter((m) => m.organizationId === org.id),
      modules: access.modules,
      disabled: access.disabled,
    });
  }
  const goals = await consoleDb
    .select()
    .from(pilotGoal)
    .where(eq(pilotGoal.subscriptionId, row.subscription.id))
    .orderBy(asc(pilotGoal.position));
  const trail = await consoleDb
    .select({
      id: consoleAuditLog.id,
      action: consoleAuditLog.action,
      reason: consoleAuditLog.reason,
      createdAt: consoleAuditLog.createdAt,
      actorName: user.name,
    })
    .from(consoleAuditLog)
    .leftJoin(user, eq(user.id, consoleAuditLog.actorUserId))
    .where(eq(consoleAuditLog.billingAccountId, billingAccountId))
    .orderBy(desc(consoleAuditLog.createdAt))
    .limit(50);
  // Each organization's latest snapshot (CLAUDE.console.md §7).
  const usage: UsageRow[] =
    ids.length === 0
      ? []
      : await consoleDb
          .selectDistinctOn([tenantUsage.organizationId])
          .from(tenantUsage)
          .where(inArray(tenantUsage.organizationId, ids))
          .orderBy(tenantUsage.organizationId, desc(tenantUsage.measuredOn));
  return { ...row, addons, organizations: withAccess, goals, trail, usage };
}

/** The catalog: plans (with how many subscriptions use each) and the add-ons, live first. */
export async function listCatalog(_ctx: OperatorCtx) {
  const plans = await consoleDb
    .select({
      plan,
      subscriptions: sql<number>`(select count(*)::int from console.subscription s where s.plan_id = ${plan.id})`,
    })
    .from(plan)
    .orderBy(sql`${plan.archivedAt} is not null`, asc(plan.yearlyPrice));
  const addons = await consoleDb
    .select()
    .from(addon)
    .orderBy(sql`${addon.archivedAt} is not null`, asc(addon.code), desc(addon.createdAt));
  return { plans: plans.map((p) => ({ ...p.plan, subscriptions: p.subscriptions })), addons };
}
