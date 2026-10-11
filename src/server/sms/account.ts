import "server-only";

import { eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { smsAccount } from "@/db/schema";
import type { WhatsappKind } from "@/lib/whatsapp";
import { decryptSecret } from "@/server/secrets";
import { devGatewaysEnabled, standInUrl } from "@/server/stand-ins";

import type { SmsGateway } from "./gateway";

/** The gateway's URL: the account's, else the local stand-in where it is on (null: none). */
export function smsApiUrl(saved: string | null): string | null {
  if (saved) return saved.replace(/\/$/, "");
  return devGatewaysEnabled() ? standInUrl("sms") : null;
}

/** The organization's SMS account, its API key decrypted on demand; null when never set up. */
export async function loadSmsAccount(tx: Tx, orgId: string) {
  const [row] = await tx.select().from(smsAccount).where(eq(smsAccount.organizationId, orgId));
  if (!row) return null;
  return {
    ...row,
    gateway: (): SmsGateway | null => {
      const baseUrl = smsApiUrl(row.apiUrl);
      return baseUrl
        ? { baseUrl, apiKey: decryptSecret(row.apiKeyEncrypted), sender: row.sender }
        : null;
    },
  };
}

/** Whether the organization sends this notification by SMS. */
export function sendsSms(
  account: { enabled: boolean; kinds: WhatsappKind[] } | null,
  kind: WhatsappKind,
): boolean {
  return account !== null && account.enabled && account.kinds.includes(kind);
}
