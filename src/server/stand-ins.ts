import "server-only";

import { env } from "@/env";

/**
 * The local stand-ins of external services (`/api/dev/*`: SATIM, WhatsApp Cloud API, SMS gateway), so the
 * flows work without credentials: DEV_GATEWAYS, else on outside production builds.
 */
export const devGatewaysEnabled = (): boolean => env.DEV_GATEWAYS ?? env.NODE_ENV !== "production";

/** Base URL of a stand-in, served by this app. */
export const standInUrl = (service: "satim" | "whatsapp" | "sms"): string =>
  `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/dev/${service}`;
