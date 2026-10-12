import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { smsAccount, smsMessage, smsOptOut } from "@/db/schema";
import { type TenantScope, withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { queues } from "@/jobs/queues";
import { smsGsmText, smsNumber, smsSegments } from "@/lib/sms";
import { whatsappKinds, type WhatsappKind } from "@/lib/whatsapp";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { encryptSecret } from "@/server/secrets";
import { companyName } from "@/server/whatsapp/account";
import { tenantWritable } from "@/server/entitlements/access";

import { loadSmsAccount } from "./account";
import { sendSms } from "./gateway";
import type {
  removeSmsOptOutSchema,
  smsOptOutSchema,
  smsSettingsSchema,
  testSmsSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/**
 * Saves the SMS account (gérant, `organization:update`). An empty API key keeps the saved one.
 * Audited (never the key).
 */
export async function saveSmsSettings(ctx: TenantCtx, input: In<typeof smsSettingsSchema>) {
  assertCan(ctx, "organization:update");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(smsAccount)
      .where(eq(smsAccount.organizationId, ctx.orgId))
      .for("update");
    if (!current && input.apiKey === "") throw invalid("apiKey", "validation.required");
    const kinds = whatsappKinds.filter((k) => input.kinds.includes(k));
    const settings = {
      enabled: input.enabled,
      provider: input.provider,
      apiUrl: input.apiUrl || null,
      sender: input.sender,
      language: input.language,
      kinds,
      updatedBy: ctx.userId,
      ...(input.apiKey ? { apiKeyEncrypted: encryptSecret(input.apiKey) } : {}),
    };
    if (current) {
      await tx.update(smsAccount).set(settings).where(eq(smsAccount.organizationId, ctx.orgId));
    } else {
      await tx.insert(smsAccount).values({
        organizationId: ctx.orgId,
        ...settings,
        apiKeyEncrypted: encryptSecret(input.apiKey),
      });
    }
    const visible = (s: {
      enabled: boolean;
      provider: string;
      apiUrl: string | null;
      sender: string;
      language: string;
      kinds: WhatsappKind[];
    }) => ({
      enabled: s.enabled,
      provider: s.provider,
      apiUrl: s.apiUrl,
      sender: s.sender,
      language: s.language,
      kinds: s.kinds,
    });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.sms",
      entityType: "organization",
      entityId: ctx.orgId,
      before: current ? visible(current) : null,
      after: { ...visible(settings), keyChanged: input.apiKey !== "" },
    });
  });
}

/** Numbers that asked for no SMS, among some. */
async function optedOut(tx: Tx, phones: string[]): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const rows = await tx
    .select({ phone: smsOptOut.phone })
    .from(smsOptOut)
    .where(inArray(smsOptOut.phone, phones));
  return new Set(rows.map((r) => r.phone));
}

/**
 * Queues one SMS per mobile number (each once, never to a number that asked for none), in the
 * caller's transaction: the worker sends it (`sms.send`). Returns the numbers queued.
 */
export async function queueSms(
  tx: Tx,
  scope: TenantScope & { userId?: string | null },
  message: {
    kind: WhatsappKind | null;
    ref: { type: string; id: string } | null;
    recipients: { phone: string; name: string; text: string }[];
  },
): Promise<string[]> {
  const numbers = message.recipients.flatMap((r) => {
    const to = smsNumber(r.phone);
    return to ? [{ ...r, to, text: smsGsmText(r.text) }] : [];
  });
  const stopped = await optedOut(
    tx,
    numbers.map((n) => n.to),
  );
  const queued: string[] = [];
  for (const recipient of numbers) {
    if (stopped.has(recipient.to) || queued.includes(recipient.to)) continue;
    queued.push(recipient.to);
    const [row] = await tx
      .insert(smsMessage)
      .values({
        organizationId: scope.orgId,
        kind: message.kind,
        recipient: recipient.to,
        recipientName: recipient.name,
        text: recipient.text,
        segments: smsSegments(recipient.text).segments,
        refType: message.ref?.type ?? null,
        refId: message.ref?.id ?? null,
        createdBy: scope.userId ?? null,
      })
      .returning({ id: smsMessage.id });
    if (!row) throw new Error("queueSms: no row returned");
    await enqueueInTx(
      tx,
      "sms.send",
      { organizationId: scope.orgId, messageId: row.id },
      { singletonKey: `sms:${row.id}` },
    );
  }
  return queued;
}

const RETRY_LIMIT = queues["sms.send"].retryLimit;

/**
 * Job `sms.send`: sends one queued message through the organization's gateway → `sent` with
 * the gateway's id; refused → `failed` with its answer; unreachable or throttling → retried,
 * `failed` after the last try. Idempotent (only a queued message is sent).
 */
export async function sendSmsMessage(
  orgId: string,
  messageId: string,
  attempt: number,
): Promise<"sent" | "failed" | "skipped"> {
  const scope = { orgId };
  const loaded = await withTenant(scope, async (tx) => {
    const [message] = await tx.select().from(smsMessage).where(eq(smsMessage.id, messageId));
    return message ? { message, account: await loadSmsAccount(tx, orgId) } : null;
  });
  if (!loaded || loaded.message.status !== "queued") return "skipped";
  const { message, account } = loaded;
  const fail = async (error: string) => {
    await withTenant(scope, (tx) =>
      tx
        .update(smsMessage)
        .set({ status: "failed", error, failedAt: new Date() })
        .where(and(eq(smsMessage.id, messageId), eq(smsMessage.status, "queued"))),
    );
    return "failed" as const;
  };
  // A read-only organization sends nothing (CLAUDE.console.md §6).
  if (!(await tenantWritable(orgId))) return fail("tenant_read_only");
  const gateway = account?.enabled ? account.gateway() : null;
  if (!gateway) return fail("SMS disabled");
  const result = await sendSms(gateway, { to: message.recipient, text: message.text });
  if (result.ok) {
    await withTenant(scope, (tx) =>
      tx
        .update(smsMessage)
        .set({ status: "sent", providerId: result.id, sentAt: new Date(), error: null })
        .where(and(eq(smsMessage.id, messageId), eq(smsMessage.status, "queued"))),
    );
    return "sent";
  }
  if (result.retry && attempt < RETRY_LIMIT) throw new Error(`sms: ${result.error}`);
  return fail(result.error);
}

/** A test message to one number from the settings page (gérant): it shows in the log. */
export async function sendTestSms(ctx: TenantCtx, input: In<typeof testSmsSchema>) {
  assertCan(ctx, "organization:update");
  return withTenant(ctx, async (tx) => {
    const account = await loadSmsAccount(tx, ctx.orgId);
    if (!account?.enabled) throw new AppError("CONFLICT", "sms.errors.disabled");
    const company = await companyName(tx, ctx.orgId);
    const text =
      account.language === "ar"
        ? `رسالة تجريبية من ${company}: إشعارات الرسائل القصيرة جاهزة.`
        : `Message d'essai de ${company} : les notifications par SMS sont prêtes.`;
    const queued = await queueSms(tx, ctx, {
      kind: null,
      ref: null,
      recipients: [{ phone: input.phone, name: input.phone, text }],
    });
    if (queued.length === 0) throw invalid("phone", "sms.errors.notMobile");
    return { queued: queued.length };
  });
}

/** Records that a number asked for no more SMS (`notification:update`). Audited. */
export async function addSmsOptOut(ctx: TenantCtx, input: In<typeof smsOptOutSchema>) {
  assertCan(ctx, "notification:update");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(smsOptOut)
      .values({
        organizationId: ctx.orgId,
        phone: input.phone,
        reason: input.reason,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: smsOptOut.id });
    if (!row) return;
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "sms.opt_out",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { phone: input.phone, reason: input.reason },
    });
  });
}

/** The person agrees to SMS again: the number is taken off the list. Audited. */
export async function removeSmsOptOut(ctx: TenantCtx, input: In<typeof removeSmsOptOutSchema>) {
  assertCan(ctx, "notification:update");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .delete(smsOptOut)
      .where(eq(smsOptOut.id, input.optOutId))
      .returning({ phone: smsOptOut.phone });
    if (!row) throw new AppError("NOT_FOUND");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "sms.opt_in",
      entityType: "organization",
      entityId: ctx.orgId,
      before: { phone: row.phone },
    });
  });
}
