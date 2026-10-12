import "server-only";

import { randomBytes } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import {
  buyer,
  lease,
  resident,
  whatsappAccount,
  whatsappMessage,
  type WhatsappNotificationSettings,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { queues } from "@/jobs/queues";
import { AppError } from "@/lib/result";
import { isStopReply, whatsappKinds } from "@/lib/whatsapp";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { recordConsentChanges } from "@/server/privacy/consents";
import { loadResidence } from "@/server/residences/service";
import { encryptSecret } from "@/server/secrets";
import { tenantWritable } from "@/server/entitlements/access";

import { loadWhatsappAccount } from "./account";
import { readWebhook, sendTemplate, validWebhookSignature } from "./cloud-api";
import type { residentWhatsappSchema, whatsappSettingsSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/**
 * Saves the WhatsApp Business number (gérant). Empty secrets keep the saved ones; the webhook's
 * verify token is drawn once. Audited (never the secrets).
 */
export async function saveWhatsappSettings(
  ctx: TenantCtx,
  input: In<typeof whatsappSettingsSchema>,
) {
  assertCan(ctx, "organization:update");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(whatsappAccount)
      .where(eq(whatsappAccount.organizationId, ctx.orgId))
      .for("update");
    if (!current && input.accessToken === "") {
      throw invalid("accessToken", "validation.required");
    }
    const notifications: WhatsappNotificationSettings = Object.fromEntries(
      input.notifications.map((n) => [n.kind, { enabled: n.enabled, template: n.template }]),
    );
    const settings = {
      enabled: input.enabled,
      phoneNumberId: input.phoneNumberId,
      businessAccountId: input.businessAccountId,
      language: input.language,
      notifications,
      updatedBy: ctx.userId,
      ...(input.accessToken ? { accessTokenEncrypted: encryptSecret(input.accessToken) } : {}),
      ...(input.appSecret ? { appSecretEncrypted: encryptSecret(input.appSecret) } : {}),
    };
    if (current) {
      await tx
        .update(whatsappAccount)
        .set(settings)
        .where(eq(whatsappAccount.organizationId, ctx.orgId));
    } else {
      await tx.insert(whatsappAccount).values({
        organizationId: ctx.orgId,
        ...settings,
        accessTokenEncrypted: encryptSecret(input.accessToken),
        verifyToken: randomBytes(24).toString("base64url"),
      });
    }
    const visible = (s: {
      enabled: boolean;
      phoneNumberId: string;
      language: string;
      notifications: WhatsappNotificationSettings;
    }) => ({
      enabled: s.enabled,
      phoneNumberId: s.phoneNumberId,
      language: s.language,
      notifications: whatsappKinds.filter((k) => s.notifications[k]?.enabled),
    });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.whatsapp",
      entityType: "organization",
      entityId: ctx.orgId,
      before: current ? visible(current) : null,
      after: {
        ...visible(settings),
        tokenChanged: input.accessToken !== "",
        appSecretChanged: input.appSecret !== "",
      },
    });
  });
}

/** Records a co-owner's or occupant's consent to WhatsApp notifications (gestionnaire). */
export async function setResidentWhatsapp(
  ctx: TenantCtx,
  input: In<typeof residentWhatsappSchema>,
) {
  assertCan(ctx, "residence:update");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ residenceId: resident.residenceId, optIn: resident.whatsappOptIn })
      .from(resident)
      .where(eq(resident.id, input.residentId));
    if (!row) throw new AppError("NOT_FOUND");
    await loadResidence(tx, row.residenceId);
    await tx
      .update(resident)
      .set({ whatsappOptIn: input.optIn })
      .where(eq(resident.id, input.residentId));
    await recordConsentChanges(
      tx,
      ctx,
      { type: "resident", id: input.residentId },
      { whatsapp: row.optIn },
      { whatsapp: input.optIn },
    );
  });
}

const RETRY_LIMIT = queues["whatsapp.send"].retryLimit;

/**
 * `whatsapp.send`: sends one queued message through the Cloud API. Accepted → `sent` with Meta's
 * id (the webhook then reports delivery and reading); refused → `failed` with Meta's error;
 * Meta unreachable or throttling → thrown, so pg-boss retries (`failed` after the last try).
 */
export async function sendWhatsappMessage(
  orgId: string,
  messageId: string,
  attempt: number,
): Promise<"sent" | "failed" | "skipped"> {
  const scope = { orgId };
  const loaded = await withTenant(scope, async (tx) => {
    const [message] = await tx
      .select()
      .from(whatsappMessage)
      .where(eq(whatsappMessage.id, messageId));
    return message ? { message, account: await loadWhatsappAccount(tx, orgId) } : null;
  });
  if (!loaded || loaded.message.status !== "queued") return "skipped";
  const { message, account } = loaded;
  const fail = async (error: string) => {
    await withTenant(scope, (tx) =>
      tx
        .update(whatsappMessage)
        .set({ status: "failed", error, failedAt: new Date() })
        .where(and(eq(whatsappMessage.id, messageId), eq(whatsappMessage.status, "queued"))),
    );
    return "failed" as const;
  };
  // A read-only organization sends nothing (CLAUDE.console.md §6).
  if (!(await tenantWritable(orgId))) return fail("tenant_read_only");
  if (!account?.enabled) return fail("WhatsApp disabled");

  const result = await sendTemplate(account.cloud(), {
    to: message.recipient,
    template: message.template,
    language: message.language,
    params: message.params,
  });
  if (result.ok) {
    await withTenant(scope, (tx) =>
      tx
        .update(whatsappMessage)
        .set({ status: "sent", wamid: result.wamid, sentAt: new Date(), error: null })
        .where(and(eq(whatsappMessage.id, messageId), eq(whatsappMessage.status, "queued"))),
    );
    return "sent";
  }
  if (result.retry && attempt < RETRY_LIMIT) throw new Error(`whatsapp: ${result.error}`);
  return fail(result.error);
}

/** Meta's status names, in the order they happen; a status never goes back. */
const statusRank = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;

/**
 * Webhook verification (`GET`, when the URL is set up in Meta's app): the challenge is echoed
 * when the verify token is the organization's. Null otherwise.
 */
export async function verifyWhatsappWebhook(
  orgId: string,
  params: URLSearchParams,
): Promise<string | null> {
  const account = await withTenant({ orgId }, (tx) => loadWhatsappAccount(tx, orgId));
  if (!account || params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== account.verifyToken) return null;
  return params.get("hub.challenge");
}

/**
 * Webhook call (`POST`), signed with the app secret: delivery statuses update the log (never
 * backwards); a « STOP » reply withdraws the consent of every buyer file, resident and tenant
 * with that number. False when the call is not authentic (no app secret saved, bad signature).
 */
export async function receiveWhatsappWebhook(
  orgId: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const scope = { orgId };
  const account = await withTenant(scope, (tx) => loadWhatsappAccount(tx, orgId));
  const secret = account?.appSecret() ?? null;
  if (!secret || !validWebhookSignature(secret, rawBody, signature)) return false;
  const events = readWebhook(rawBody);
  if (!events) return true;

  await withTenant(scope, async (tx) => {
    for (const event of events.statuses) {
      if (!(event.status in statusRank)) continue;
      const status = event.status as keyof typeof statusRank;
      const [message] = await tx
        .select({ id: whatsappMessage.id, status: whatsappMessage.status })
        .from(whatsappMessage)
        .where(eq(whatsappMessage.wamid, event.wamid))
        .for("update");
      if (!message || statusRank[status] <= statusRank[message.status]) continue;
      await tx
        .update(whatsappMessage)
        .set({
          status,
          ...(status === "delivered" ? { deliveredAt: event.at } : {}),
          ...(status === "read" ? { readAt: event.at } : {}),
          ...(status === "failed" ? { failedAt: event.at, error: event.error } : {}),
        })
        .where(eq(whatsappMessage.id, message.id));
    }
    const stops = events.replies.filter((r) => isStopReply(r.text)).map((r) => `+${r.from}`);
    if (stops.length > 0) {
      // Each record whose consent the « STOP » withdraws keeps the event as proof.
      const withdrawn = [
        ...(
          await tx
            .update(buyer)
            .set({ whatsappOptIn: false })
            .where(and(inArray(buyer.phone, stops), eq(buyer.whatsappOptIn, true)))
            .returning({ id: buyer.id, phone: buyer.phone })
        ).map((r) => ({ type: "buyer" as const, ...r })),
        ...(
          await tx
            .update(resident)
            .set({ whatsappOptIn: false })
            .where(and(inArray(resident.phone, stops), eq(resident.whatsappOptIn, true)))
            .returning({ id: resident.id, phone: resident.phone })
        ).map((r) => ({ type: "resident" as const, ...r })),
        ...(
          await tx
            .update(lease)
            .set({ tenantWhatsappOptIn: false })
            .where(and(inArray(lease.tenantPhone, stops), eq(lease.tenantWhatsappOptIn, true)))
            .returning({ id: lease.id, phone: lease.tenantPhone })
        ).map((r) => ({ type: "lease" as const, ...r })),
      ];
      for (const record of withdrawn) {
        await recordConsentChanges(
          tx,
          { orgId },
          { type: record.type, id: record.id },
          { whatsapp: true },
          { whatsapp: false },
          "stop_reply",
          record.phone,
        );
      }
    }
  });
  return true;
}
