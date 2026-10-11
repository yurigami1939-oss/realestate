import "server-only";

import { and, eq, lt, ne, notExists, sql } from "drizzle-orm";
import type { z } from "zod";

import { db, type Tx } from "@/db/client";
import {
  buyer,
  lead,
  leadActivity,
  organization,
  organizationSetting,
  smsMessage,
  whatsappMessage,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueue } from "@/jobs/enqueue";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import {
  ANONYMIZED_NAME,
  ERASED_RECIPIENT,
  type PrivacySettings,
  privacySettings,
  retentionCutoff,
} from "@/lib/privacy";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type { privacySettingsSchema } from "./schemas";
import { eraseLead } from "./service";

/** The reason printed on prospects anonymized by the retention period. */
export const RETENTION_REASON = "Durée de conservation dépassée";

export async function loadPrivacySettings(tx: Tx, orgId: string): Promise<PrivacySettings> {
  const [row] = await tx
    .select({ privacy: organizationSetting.privacySettings })
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, orgId));
  return privacySettings(row?.privacy ?? null);
}

/** The gérant's retention periods (`organization:update`). Audited `organization.privacy`. */
export async function savePrivacySettings(
  ctx: TenantCtx,
  input: z.output<typeof privacySettingsSchema>,
) {
  assertCan(ctx, "organization:update");
  await withTenant(ctx, async (tx) => {
    const before = await loadPrivacySettings(tx, ctx.orgId);
    await tx
      .insert(organizationSetting)
      .values({ organizationId: ctx.orgId, privacySettings: input, updatedBy: ctx.userId })
      .onConflictDoUpdate({
        target: organizationSetting.organizationId,
        set: { privacySettings: input, updatedBy: ctx.userId, updatedAt: new Date() },
      });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.privacy",
      entityType: "organization",
      entityId: ctx.orgId,
      before,
      after: input,
    });
  });
}

/** The Algiers day of a timestamp column, for comparisons with calendar days. */
const algiersDay = (column: unknown) => sql`(${column} at time zone 'Africa/Algiers')::date`;

/**
 * Applies the organization's retention periods (CLAUDE.md §7 Personal data), as of a day:
 * prospects no buyer file comes from and not won, whose last activity (an update or a timeline
 * event) is older than the prospects' period, are anonymized like an erasure (audited
 * `lead.anonymize`, no actor); the recipients, parameters and texts of WhatsApp and SMS
 * messages older than the messages' period are erased (their kind, status and dates stay).
 * A run that changed something is audited `organization.retention`. Idempotent.
 */
export async function applyRetention(orgId: string, today: CalendarDate) {
  return withTenant({ orgId }, async (tx) => {
    const settings = await loadPrivacySettings(tx, orgId);
    let leads = 0;
    let messages = 0;

    const leadCutoff = retentionCutoff(today, settings.leadRetentionMonths);
    if (leadCutoff) {
      const lastActivity = sql`greatest(${lead.updatedAt}, coalesce((
        select max(${leadActivity.createdAt}) from ${leadActivity}
        where ${leadActivity.leadId} = ${lead.id}), ${lead.createdAt}))`;
      const stale = await tx
        .select({ id: lead.id })
        .from(lead)
        .where(
          and(
            ne(lead.fullName, ANONYMIZED_NAME),
            ne(lead.stage, "won"),
            notExists(tx.select({ id: buyer.id }).from(buyer).where(eq(buyer.leadId, lead.id))),
            sql`${algiersDay(lastActivity)} < ${leadCutoff}::date`,
          ),
        );
      for (const { id } of stale) {
        await eraseLead(tx, id);
        await recordAudit(
          tx,
          { orgId },
          {
            actorUserId: null,
            action: "lead.anonymize",
            entityType: "lead",
            entityId: id,
            reason: RETENTION_REASON,
          },
        );
      }
      leads = stale.length;
    }

    const messageCutoff = retentionCutoff(today, settings.messageRetentionMonths);
    if (messageCutoff) {
      const whatsapp = await tx
        .update(whatsappMessage)
        .set({ recipient: ERASED_RECIPIENT, recipientName: ERASED_RECIPIENT, params: [] })
        .where(
          and(
            ne(whatsappMessage.recipient, ERASED_RECIPIENT),
            lt(algiersDay(whatsappMessage.createdAt), sql`${messageCutoff}::date`),
          ),
        )
        .returning({ id: whatsappMessage.id });
      const sms = await tx
        .update(smsMessage)
        .set({ recipient: ERASED_RECIPIENT, recipientName: ERASED_RECIPIENT, text: "" })
        .where(
          and(
            ne(smsMessage.recipient, ERASED_RECIPIENT),
            lt(algiersDay(smsMessage.createdAt), sql`${messageCutoff}::date`),
          ),
        )
        .returning({ id: smsMessage.id });
      messages = whatsapp.length + sms.length;
    }

    if (leads + messages > 0) {
      await recordAudit(
        tx,
        { orgId },
        {
          actorUserId: null,
          action: "organization.retention",
          entityType: "organization",
          entityId: orgId,
          after: { day: today, leads, messages, ...settings },
        },
      );
    }
    return { leads, messages };
  });
}

/** `privacy.daily` (cron 03:00 Algiers): one retention job per organization. */
export async function queueRetentionJobs(): Promise<number> {
  const date = todayInAlgiers();
  // `organization` is Better Auth's tenant table: no RLS, every tenant is listed.
  const tenants = await db.select({ id: organization.id }).from(organization);
  for (const { id } of tenants) {
    await enqueue(
      "privacy.retention",
      { organizationId: id, date },
      { singletonKey: `retention:${id}`, singletonSeconds: 86_400 },
    );
  }
  return tenants.length;
}

/** The retention periods for the settings page (`organization:update`). */
export async function getPrivacySettings(ctx: TenantCtx): Promise<PrivacySettings> {
  assertCan(ctx, "organization:update");
  return withTenant(ctx, (tx) => loadPrivacySettings(tx, ctx.orgId));
}
