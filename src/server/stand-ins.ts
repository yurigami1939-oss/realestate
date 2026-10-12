import "server-only";

import { env } from "@/env";

/**
 * The local stand-ins of external services (`/api/dev/*`: SATIM, WhatsApp Cloud API, SMS gateway,
 * a Web Push service), so the flows work without credentials: DEV_GATEWAYS, else on outside
 * production builds and on the demo deployment (DEMO_MODE).
 */
export const devGatewaysEnabled = (): boolean =>
  env.DEV_GATEWAYS ?? (env.DEMO_MODE === true || env.NODE_ENV !== "production");

/** Base URL of a stand-in, served by this app. */
export const standInUrl = (service: "satim" | "whatsapp" | "sms" | "push"): string =>
  `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/dev/${service}`;
