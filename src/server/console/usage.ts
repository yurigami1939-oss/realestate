import "server-only";

import { and, count, countDistinct, eq, gte, isNull, lt, max, sql, sum } from "drizzle-orm";

import { consoleDb } from "@/db/console-client";
import {
  auditLog,
  chargePayment,
  chargeReminder,
  file,
  lead,
  member,
  organization,
  payment,
  project,
  reminderLetter,
  rentPayment,
  residence,
  unit,
  residenceUnit,
  tenantUsage,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { isPortalOnly, parseRoles } from "@/lib/permissions";
import { countActiveUnits } from "@/server/entitlements/capacity";

/** Usage rows are kept this long (CLAUDE.console.md §3). */
export const USAGE_KEEP_DAYS = 400;

export type UsageSnapshot = Omit<typeof tenantUsage.$inferInsert, "organizationId" | "measuredOn">;

/**
 * Measures one organization (CLAUDE.console.md §7), read with the app role in its own tenant:
 * projects and units, active units (the pricing metric), managed lots (the syndic's), staff and
 * portal accounts, storage, and the pilot's indicators over 30 days — receipts (sales, charges,
 * rents), reminder letters, members who acted, leads — with its last activity.
 */
export async function measureOrganization(organizationId: string): Promise<UsageSnapshot> {
  return withTenant({ orgId: organizationId }, async (tx) => {
    const since = sql`now() - interval '30 days'`;
    const one = async (query: Promise<{ n: number | string | null }[]>) =>
      Number((await query)[0]?.n ?? 0);
    const projects = await one(
      tx.select({ n: count() }).from(project).where(isNull(project.deletedAt)),
    );
    const units = await one(tx.select({ n: count() }).from(unit).where(isNull(unit.deletedAt)));
    const activeUnits = await countActiveUnits(tx);
    const managedLots = await one(
      tx
        .select({ n: count() })
        .from(residenceUnit)
        .innerJoin(residence, eq(residence.id, residenceUnit.residenceId))
        .where(isNull(residence.deletedAt)),
    );
    // `member` is Better Auth's (no RLS): filter on the organization explicitly.
    const members = await tx
      .select({ role: member.role })
      .from(member)
      .where(eq(member.organizationId, organizationId));
    const portalAccounts = members.filter((m) => isPortalOnly(parseRoles(m.role))).length;
    const storageBytes = await one(
      tx
        .select({ n: sum(file.sizeBytes) })
        .from(file)
        .where(isNull(file.deletedAt)),
    );
    const receipts30d =
      (await one(
        tx
          .select({ n: count() })
          .from(payment)
          .where(and(eq(payment.status, "valid"), gte(payment.createdAt, since))),
      )) +
      (await one(
        tx
          .select({ n: count() })
          .from(chargePayment)
          .where(and(eq(chargePayment.status, "valid"), gte(chargePayment.createdAt, since))),
      )) +
      (await one(
        tx
          .select({ n: count() })
          .from(rentPayment)
          .where(and(eq(rentPayment.status, "valid"), gte(rentPayment.createdAt, since))),
      ));
    const reminders30d =
      (await one(
        tx.select({ n: count() }).from(reminderLetter).where(gte(reminderLetter.issuedAt, since)),
      )) +
      (await one(
        tx.select({ n: count() }).from(chargeReminder).where(gte(chargeReminder.issuedAt, since)),
      ));
    const activity = await tx
      .select({ n: countDistinct(auditLog.actorUserId) })
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, organizationId), gte(auditLog.createdAt, since)));
    const [lastEver] = await tx
      .select({ last: max(auditLog.createdAt) })
      .from(auditLog)
      .where(eq(auditLog.organizationId, organizationId));
    const leads30d = await one(
      tx.select({ n: count() }).from(lead).where(gte(lead.createdAt, since)),
    );
    return {
      projects,
      units,
      activeUnits,
      managedLots,
      staffMembers: members.length - portalAccounts,
      portalAccounts,
      storageBytes,
      receipts30d,
      reminders30d,
      activeMembers30d: Number(activity[0]?.n ?? 0),
      leads30d,
      lastActivityAt: lastEver?.last ?? null,
    };
  });
}

/** Measures one organization and keeps the day's snapshot (the console role writes it). */
export async function snapshotOrganization(
  organizationId: string,
  measuredOn: CalendarDate = todayInAlgiers(),
): Promise<UsageSnapshot> {
  const usage = await measureOrganization(organizationId);
  await consoleDb
    .insert(tenantUsage)
    .values({ organizationId, measuredOn, ...usage })
    .onConflictDoUpdate({
      target: [tenantUsage.organizationId, tenantUsage.measuredOn],
      set: usage,
    });
  return usage;
}

/**
 * `console.usage` (02:00 Algiers): one snapshot per organization, then the snapshots older than
 * 400 days pruned. Returns the number of organizations measured.
 */
export async function runUsageSnapshot(today: CalendarDate = todayInAlgiers()): Promise<number> {
  const organizations = await consoleDb.select({ id: organization.id }).from(organization);
  for (const { id } of organizations) await snapshotOrganization(id, today);
  await pruneUsage(today);
  return organizations.length;
}

/** Drops the snapshots older than 400 days. */
export async function pruneUsage(today: CalendarDate = todayInAlgiers()): Promise<void> {
  await consoleDb
    .delete(tenantUsage)
    .where(lt(tenantUsage.measuredOn, addDays(today, -USAGE_KEEP_DAYS)));
}
