import "server-only";

import { eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { organization, whatsappAccount, type WhatsappNotificationSettings } from "@/db/schema";
import { env } from "@/env";
import { type WhatsappKind, whatsappTemplates } from "@/lib/whatsapp";
import { decryptSecret } from "@/server/secrets";
import { devGatewaysEnabled, standInUrl } from "@/server/stand-ins";

import type { CloudAccount } from "./cloud-api";

const GRAPH_API = "https://graph.facebook.com/v23.0";

/** The Cloud API's base URL: WHATSAPP_API_URL, else the stand-in when it is on, else Meta's. */
export const whatsappApiUrl = (): string =>
  env.WHATSAPP_API_URL ?? (devGatewaysEnabled() ? standInUrl("whatsapp") : GRAPH_API);

/** The organization's WhatsApp account, secrets decrypted on demand; null when never set up. */
export async function loadWhatsappAccount(tx: Tx, orgId: string) {
  const [row] = await tx
    .select()
    .from(whatsappAccount)
    .where(eq(whatsappAccount.organizationId, orgId));
  if (!row) return null;
  return {
    ...row,
    cloud: (): CloudAccount => ({
      baseUrl: whatsappApiUrl(),
      phoneNumberId: row.phoneNumberId,
      accessToken: decryptSecret(row.accessTokenEncrypted),
    }),
    appSecret: (): string | null =>
      row.appSecretEncrypted ? decryptSecret(row.appSecretEncrypted) : null,
  };
}

/**
 * The template the organization sends for a kind, or null: WhatsApp off, or this notification
 * not switched on (each one waits for its template to be approved by Meta).
 */
export function templateFor(
  account: { enabled: boolean; notifications: WhatsappNotificationSettings },
  kind: WhatsappKind,
): string | null {
  const setting = account.notifications[kind];
  if (!account.enabled || !setting?.enabled) return null;
  return setting.template.trim() || whatsappTemplates[kind].name;
}

/** The promoter's name, as signed in the messages. */
export async function companyName(tx: Tx, orgId: string): Promise<string> {
  // `organization` is Better Auth's table (no RLS): filter on the tenant's id.
  const [row] = await tx
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId));
  return row?.name ?? "";
}
