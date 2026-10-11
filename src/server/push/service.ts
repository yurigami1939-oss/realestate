import "server-only";

import { and, desc, eq, notInArray } from "drizzle-orm";
import { createTranslator } from "next-intl";
import type { z } from "zod";

import { db } from "@/db/client";
import { member, pushSubscription } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueue } from "@/jobs/enqueue";
import { type JobPayloads, queues } from "@/jobs/queues";
import type { Locale } from "@/i18n/locales";
import { isPushServiceUrl, type PushKind, type PushParams } from "@/lib/push";
import { AppError } from "@/lib/result";
import { devGatewaysEnabled, standInUrl } from "@/server/stand-ins";
import { companyName } from "@/server/whatsapp/account";

import ar from "../../../messages/ar.json";
import fr from "../../../messages/fr.json";

import type { pushDeviceSchema, pushEndpointSchema, pushSubscriptionSchema } from "./schemas";
import { sendPush } from "./webpush";

type In<S extends z.ZodType> = z.output<S>;

/** The member turning notifications on or off for themselves (staff or portal account). */
export type PushUser = { orgId: string; userId: string };

/** Devices kept per account (the latest ones). */
const MAX_DEVICES = 10;

/** A push service browsers use, or the local stand-in (DEV_GATEWAYS). */
export function allowedPushEndpoint(endpoint: string): boolean {
  if (devGatewaysEnabled() && endpoint.startsWith(`${standInUrl("push")}/`)) return true;
  return isPushServiceUrl(endpoint);
}

/**
 * Turns push notifications on for this device (CLAUDE.md §7 Push notifications): the browser's
 * subscription — a push service's endpoint and its keys — in the language of the page. An
 * endpoint already known moves to this account (another person signed in on the same browser).
 */
export async function subscribePush(user: PushUser, input: In<typeof pushSubscriptionSchema>) {
  if (!allowedPushEndpoint(input.endpoint))
    throw new AppError("VALIDATION", "push.errors.endpoint");
  const p256dh = Buffer.from(input.keys.p256dh, "base64url");
  const auth = Buffer.from(input.keys.auth, "base64url");
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) {
    throw new AppError("VALIDATION", "push.errors.keys");
  }
  const values = {
    userId: user.userId,
    p256dh: p256dh.toString("base64url"),
    auth: auth.toString("base64url"),
    locale: input.locale,
    userAgent: input.userAgent,
  };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(pushSubscription)
      .values({ ...values, endpoint: input.endpoint })
      .onConflictDoUpdate({ target: pushSubscription.endpoint, set: values })
      .returning({ id: pushSubscription.id });
    if (!row) throw new Error("subscribePush: no row returned");
    const latest = tx
      .select({ id: pushSubscription.id })
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, user.userId))
      .orderBy(desc(pushSubscription.createdAt))
      .limit(MAX_DEVICES);
    await tx
      .delete(pushSubscription)
      .where(
        and(eq(pushSubscription.userId, user.userId), notInArray(pushSubscription.id, latest)),
      );
    return { id: row.id };
  });
}

/** Turns them off for this device (the browser unsubscribed). */
export async function unsubscribePush(user: PushUser, input: In<typeof pushEndpointSchema>) {
  await db
    .delete(pushSubscription)
    .where(
      and(eq(pushSubscription.userId, user.userId), eq(pushSubscription.endpoint, input.endpoint)),
    );
}

/** Removes one of the account's devices (a phone given away, a browser not used any more). */
export async function removePushDevice(user: PushUser, input: In<typeof pushDeviceSchema>) {
  const removed = await db
    .delete(pushSubscription)
    .where(
      and(eq(pushSubscription.userId, user.userId), eq(pushSubscription.id, input.subscriptionId)),
    )
    .returning({ id: pushSubscription.id });
  if (removed.length === 0) throw new AppError("NOT_FOUND");
}

/** The account's devices, latest first. */
export async function listPushDevices(user: PushUser) {
  return db
    .select({
      id: pushSubscription.id,
      endpoint: pushSubscription.endpoint,
      userAgent: pushSubscription.userAgent,
      locale: pushSubscription.locale,
      createdAt: pushSubscription.createdAt,
      lastSentAt: pushSubscription.lastSentAt,
    })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, user.userId))
    .orderBy(desc(pushSubscription.createdAt));
}

/** A test notification to this device, to see that it arrives. */
export async function sendTestPush(user: PushUser, input: In<typeof pushEndpointSchema>) {
  const [device] = await db
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .where(
      and(eq(pushSubscription.userId, user.userId), eq(pushSubscription.endpoint, input.endpoint)),
    );
  if (!device) throw new AppError("NOT_FOUND", "push.errors.notSubscribed");
  const company = await withTenant(user, (tx) => companyName(tx, user.orgId));
  await enqueue("push.send", {
    organizationId: user.orgId,
    subscriptionId: device.id,
    kind: "test",
    params: { company },
    url: "/",
  });
}

const catalogs = { fr, ar } as const;

/** Lengths kept: push services refuse payloads above 4 KB. */
const MAX_TITLE = 120;
const MAX_BODY = 400;
const cap = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** A notification's text in the device's language (catalog `push.messages.{kind}`) and its page. */
export function pushNotification(kind: PushKind, locale: Locale, params: PushParams, url: string) {
  const t = createTranslator({
    locale,
    messages: catalogs[locale],
    namespace: `push.messages.${kind}`,
  });
  const values = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === "string" ? value : value[locale],
    ]),
  );
  return {
    title: cap(t("title", values), MAX_TITLE),
    body: cap(t("body", values), MAX_BODY),
    url: url === "/" ? `/${locale}` : `/${locale}${url}`,
    lang: locale,
  };
}

const RETRY_LIMIT = queues["push.send"].retryLimit;

/**
 * Job `push.send`: encrypts the notification for the device and posts it to its push service
 * → `sent` (the device's last sending noted); the service says the subscription is gone →
 * `gone`, the device forgotten; unreachable or throttling → retried, `failed` after the last
 * try. A device removed meanwhile, or whose account left the organization, is skipped.
 */
export async function sendPushMessage(
  job: JobPayloads["push.send"],
  attempt: number,
): Promise<"sent" | "gone" | "failed" | "skipped"> {
  // `member` has no RLS (Better Auth): always filter on the organization.
  const [device] = await db
    .select({
      id: pushSubscription.id,
      endpoint: pushSubscription.endpoint,
      p256dh: pushSubscription.p256dh,
      auth: pushSubscription.auth,
      locale: pushSubscription.locale,
    })
    .from(pushSubscription)
    .innerJoin(
      member,
      and(
        eq(member.userId, pushSubscription.userId),
        eq(member.organizationId, job.organizationId),
      ),
    )
    .where(eq(pushSubscription.id, job.subscriptionId));
  if (!device) return "skipped";
  const result = await sendPush(
    device,
    pushNotification(job.kind, device.locale, job.params, job.url),
  );
  if (result.ok) {
    await db
      .update(pushSubscription)
      .set({ lastSentAt: new Date() })
      .where(eq(pushSubscription.id, device.id));
    return "sent";
  }
  if (result.gone) {
    await db.delete(pushSubscription).where(eq(pushSubscription.id, device.id));
    return "gone";
  }
  if (result.retry && attempt < RETRY_LIMIT) throw new Error(`push: ${result.error}`);
  console.error(`[push] ${job.kind} to ${device.id}: ${result.error}`);
  return "failed";
}
