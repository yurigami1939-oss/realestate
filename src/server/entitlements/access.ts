import "server-only";

import { eq, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { organization, organizationSetting, tenantEntitlement } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { CalendarDate } from "@/lib/dates";
import { effectiveModules, type Module } from "@/lib/modules";
import { AppError } from "@/lib/result";
import { isWritable, type PlanLimits, type SubscriptionStatus } from "@/lib/subscriptions";

/** The operator behind a support session: audited as the actor of what is read. */
export type SupportOperator = { id: string; name: string };

/**
 * What the organization's subscription allows, as a request sees it (CLAUDE.console.md §4):
 * read once per request into the tenant context (`ctx.access`).
 */
export type TenantAccess = {
  /** Null: the organization has no entitlement — read-only, every module off (fail closed). */
  status: SubscriptionStatus | null;
  /** The modules on: entitled, not switched off by the gérant, prerequisites on. */
  modules: Module[];
  /** Entitled by the plan and the add-ons. */
  entitled: Module[];
  /** Switched off by the gérant. */
  disabled: Module[];
  limits: PlanLimits | null;
  pilotEndsOn: CalendarDate | null;
  currentPeriodEnd: CalendarDate | null;
  /** Suspended, terminated, no entitlement, or an operator's support session. */
  readOnly: boolean;
  /** The operator viewing the organization in a support session (read-only, CLAUDE.console.md §12). */
  supportBy: SupportOperator | null;
};

/** The access of the organization the open tenant transaction is set on (one query). */
export async function readAccess(tx: Tx): Promise<TenantAccess> {
  const [row] = await tx
    .select({
      status: tenantEntitlement.status,
      modules: tenantEntitlement.modules,
      limits: tenantEntitlement.limits,
      pilotEndsOn: tenantEntitlement.pilotEndsOn,
      currentPeriodEnd: tenantEntitlement.currentPeriodEnd,
      disabled: organizationSetting.disabledModules,
    })
    .from(organization)
    .leftJoin(tenantEntitlement, eq(tenantEntitlement.organizationId, organization.id))
    .leftJoin(organizationSetting, eq(organizationSetting.organizationId, organization.id))
    .where(sql`${organization.id} = nullif(current_setting('app.current_org', true), '')::uuid`);
  const entitled = row?.status ? (row.modules ?? []) : [];
  const disabled = row?.disabled ?? [];
  const status = row?.status ?? null;
  return {
    status,
    modules: effectiveModules(entitled, disabled),
    entitled: effectiveModules(entitled, []),
    disabled,
    limits: row?.limits ?? null,
    pilotEndsOn: row?.pilotEndsOn ?? null,
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    readOnly: !isWritable(status),
    supportBy: null,
  };
}

/** The organization's access, for its tenant context. */
export function loadTenantAccess(orgId: string): Promise<TenantAccess> {
  return withTenant({ orgId }, (tx) => readAccess(tx));
}

/** The access an operator gets in a support session: the organization's, read-only. */
export function supportAccess(access: TenantAccess, operator: SupportOperator): TenantAccess {
  return { ...access, readOnly: true, supportBy: operator };
}

/**
 * In a tenant transaction: whether a module is on for the organization — what side effects
 * follow (WhatsApp, co-owners at a handover, a lease's occupant, a payment's account). An
 * organization without entitlement has none.
 */
export async function moduleEnabled(tx: Tx, module: Module): Promise<boolean> {
  return (await readAccess(tx)).modules.includes(module);
}

/**
 * Service check for what the permission does not say (CLAUDE.console.md §5 Enforcement): a rent
 * payment, an online payment, a capture key… FORBIDDEN when the module is off. Contexts built
 * without `access` (the seed, jobs) are not restricted.
 */
export function assertModule(ctx: { access?: TenantAccess | null }, module: Module): void {
  if (ctx.access && !ctx.access.modules.includes(module)) {
    throw new AppError("FORBIDDEN", "errors.moduleOff", { details: { module } });
  }
}

/** Why an organization is read-only, as the message key's last part; null when writable. */
export function readOnlyReason(
  access: TenantAccess,
): "support" | "noEntitlement" | "suspended" | "terminated" | null {
  if (access.supportBy) return "support";
  if (!access.readOnly) return null;
  if (access.status === "suspended" || access.status === "terminated") return access.status;
  return "noEntitlement";
}

/**
 * Refuses a change while the organization is read-only (CLAUDE.console.md §6): suspended,
 * terminated, without a subscription, or seen by an operator in a support session. Reading,
 * exports and settling online payments go on. Contexts without `access` (the seed, jobs) pass.
 */
export function assertWritable(ctx: { access?: TenantAccess | null }): void {
  const reason = ctx.access ? readOnlyReason(ctx.access) : null;
  if (reason) throw new AppError("FORBIDDEN", `errors.readOnly.${reason}`);
}

/** For jobs: whether the organization may still change (digests, WhatsApp and SMS). */
export async function tenantWritable(orgId: string): Promise<boolean> {
  return !(await loadTenantAccess(orgId)).readOnly;
}
