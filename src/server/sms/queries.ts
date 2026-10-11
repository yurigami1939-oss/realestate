import "server-only";

import { and, asc, count, desc, eq } from "drizzle-orm";

import { smsAccount, smsMessage, smsOptOut, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { smsApiUrl } from "./account";
import type { SmsLogParams } from "./schemas";

export const SMS_LOG_PAGE_SIZE = 50;

/** The SMS settings page (gérant): everything but the API key (only whether one is saved). */
export async function getSmsSettings(ctx: TenantCtx) {
  assertCan(ctx, "organization:update");
  const [row] = await withTenant(ctx, (tx) =>
    tx.select().from(smsAccount).where(eq(smsAccount.organizationId, ctx.orgId)),
  );
  return {
    settings: row
      ? {
          enabled: row.enabled,
          provider: row.provider,
          apiUrl: row.apiUrl ?? "",
          sender: row.sender,
          language: row.language,
          kinds: row.kinds,
        }
      : null,
    /** Sent to the local stand-in (no URL saved, DEV_GATEWAYS on). */
    standIn: !row?.apiUrl && smsApiUrl(null) !== null,
  };
}

/** The SMS log (`notification:read`), latest first, and the numbers that asked for none. */
export async function listSmsMessages(ctx: TenantCtx, params: SmsLogParams) {
  assertCan(ctx, "notification:read");
  const page = params.page ?? 1;
  const where = and(
    params.status ? eq(smsMessage.status, params.status) : undefined,
    params.kind ? eq(smsMessage.kind, params.kind) : undefined,
  );
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: smsMessage.id,
        kind: smsMessage.kind,
        recipient: smsMessage.recipient,
        recipientName: smsMessage.recipientName,
        text: smsMessage.text,
        segments: smsMessage.segments,
        refType: smsMessage.refType,
        refId: smsMessage.refId,
        status: smsMessage.status,
        error: smsMessage.error,
        createdAt: smsMessage.createdAt,
        sentAt: smsMessage.sentAt,
      })
      .from(smsMessage)
      .where(where)
      .orderBy(desc(smsMessage.createdAt))
      .limit(SMS_LOG_PAGE_SIZE)
      .offset((page - 1) * SMS_LOG_PAGE_SIZE);
    const [total] = await tx.select({ n: count() }).from(smsMessage).where(where);
    const optOuts = await tx
      .select({
        id: smsOptOut.id,
        phone: smsOptOut.phone,
        reason: smsOptOut.reason,
        createdAt: smsOptOut.createdAt,
        createdByName: user.name,
      })
      .from(smsOptOut)
      .leftJoin(user, eq(user.id, smsOptOut.createdBy))
      .orderBy(asc(smsOptOut.phone));
    return { rows, total: total?.n ?? 0, page, optOuts };
  });
}

export type SmsLogRow = Awaited<ReturnType<typeof listSmsMessages>>["rows"][number];
