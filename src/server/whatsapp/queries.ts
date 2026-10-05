import "server-only";

import { and, count, desc, eq } from "drizzle-orm";

import { whatsappAccount, whatsappMessage } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { env } from "@/env";
import { whatsappKinds } from "@/lib/whatsapp";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { devGatewaysEnabled } from "@/server/stand-ins";

import { whatsappApiUrl } from "./account";
import type { WhatsappLogParams } from "./schemas";

export const WHATSAPP_LOG_PAGE_SIZE = 50;

/**
 * The WhatsApp settings page (gérant): everything but the secrets (only whether they are
 * saved), the webhook's URL and verify token to give Meta, each notification's state.
 */
export async function getWhatsappSettings(ctx: TenantCtx) {
  assertCan(ctx, "organization:update");
  const [row] = await withTenant(ctx, (tx) =>
    tx.select().from(whatsappAccount).where(eq(whatsappAccount.organizationId, ctx.orgId)),
  );
  return {
    settings: row
      ? {
          enabled: row.enabled,
          phoneNumberId: row.phoneNumberId,
          businessAccountId: row.businessAccountId,
          language: row.language,
          hasAppSecret: row.appSecretEncrypted !== null,
          verifyToken: row.verifyToken,
          notifications: whatsappKinds.map((kind) => ({
            kind,
            enabled: row.notifications[kind]?.enabled ?? false,
            template: row.notifications[kind]?.template ?? "",
          })),
        }
      : null,
    webhookUrl: `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/webhooks/whatsapp/${ctx.orgId}`,
    standIn: devGatewaysEnabled() && whatsappApiUrl().includes("/api/dev/whatsapp"),
  };
}

/** The message log (`notification:read`), latest first. */
export async function listWhatsappMessages(ctx: TenantCtx, params: WhatsappLogParams) {
  assertCan(ctx, "notification:read");
  const page = params.page ?? 1;
  const where = and(
    params.status ? eq(whatsappMessage.status, params.status) : undefined,
    params.kind ? eq(whatsappMessage.kind, params.kind) : undefined,
  );
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: whatsappMessage.id,
        kind: whatsappMessage.kind,
        recipient: whatsappMessage.recipient,
        recipientName: whatsappMessage.recipientName,
        template: whatsappMessage.template,
        language: whatsappMessage.language,
        params: whatsappMessage.params,
        refType: whatsappMessage.refType,
        refId: whatsappMessage.refId,
        status: whatsappMessage.status,
        error: whatsappMessage.error,
        createdAt: whatsappMessage.createdAt,
        sentAt: whatsappMessage.sentAt,
        deliveredAt: whatsappMessage.deliveredAt,
        readAt: whatsappMessage.readAt,
      })
      .from(whatsappMessage)
      .where(where)
      .orderBy(desc(whatsappMessage.createdAt))
      .limit(WHATSAPP_LOG_PAGE_SIZE)
      .offset((page - 1) * WHATSAPP_LOG_PAGE_SIZE);
    const [total] = await tx.select({ n: count() }).from(whatsappMessage).where(where);
    return { rows, total: total?.n ?? 0, page };
  });
}

export type WhatsappLogRow = Awaited<ReturnType<typeof listWhatsappMessages>>["rows"][number];
