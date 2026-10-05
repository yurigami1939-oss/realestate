import "server-only";

import { eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { paymentGateway } from "@/db/schema";
import { env } from "@/env";
import type { GatewayEnvironment } from "@/lib/online-payments";
import { decryptSecret } from "@/server/secrets";
import { devGatewaysEnabled, standInUrl } from "@/server/stand-ins";

import type { SatimAccount } from "./satim";

const SATIM_TEST_URL = "https://test.satim.dz/payment/rest";

/** Base URL of the local SATIM stand-in. */
export const satimStandInUrl = () => standInUrl("satim");

/** SATIM's REST base URL for an environment (the test one is the stand-in when it is on). */
export function satimBaseUrl(environment: GatewayEnvironment): string {
  if (environment === "production") return env.SATIM_PRODUCTION_URL;
  return env.SATIM_TEST_URL ?? (devGatewaysEnabled() ? satimStandInUrl() : SATIM_TEST_URL);
}

/** The organization's gateway settings with the decrypted account; null when never set up. */
export async function loadGateway(tx: Tx, orgId: string) {
  const [row] = await tx
    .select()
    .from(paymentGateway)
    .where(eq(paymentGateway.organizationId, orgId));
  if (!row) return null;
  const account = (environment: GatewayEnvironment): SatimAccount => ({
    baseUrl: satimBaseUrl(environment),
    username: row.username,
    password: decryptSecret(row.passwordEncrypted),
    terminalId: row.terminalId,
  });
  return { ...row, account };
}

export type LoadedGateway = NonNullable<Awaited<ReturnType<typeof loadGateway>>>;
