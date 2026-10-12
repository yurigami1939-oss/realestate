/**
 * Better Auth options that shape the database schema. Shared by the runtime config
 * (src/server/auth/auth.ts) and the schema generator config (scripts/auth-schema.config.ts).
 * After changing anything here run `pnpm auth:generate` then `pnpm db:generate`.
 */
import { BRAND_NAME } from "../../lib/brand";

/** Random UUIDs keep invitation ids unguessable (Better Auth recommendation). */
export const authIdStrategy = "uuid" as const;

export const userAdditionalFields = {
  locale: { type: "string", required: false, defaultValue: "fr", input: true },
} as const;

/** Legal identity of the promoter (SARL), printed on receipts and contracts. */
export const organizationAdditionalFields = {
  legalName: { type: "string", required: false },
  rcNumber: { type: "string", required: false },
  nif: { type: "string", required: false },
  nis: { type: "string", required: false },
  aiNumber: { type: "string", required: false },
  address: { type: "string", required: false },
  wilaya: { type: "string", required: false },
  phone: { type: "string", required: false },
} as const;

/**
 * The operators of the SaaS (CLAUDE.console.md §9): Better Auth's admin plugin, whose admin role
 * is `operator` (adds `user.role`, the ban columns and `session.impersonated_by`). Bans are never
 * used for billing; impersonation is the support session (read-only, 60 minutes).
 */
export const OPERATOR_ROLE = "operator" as const;
export const SUPPORT_SESSION_SECONDS = 60 * 60;

/** Name shown in the member's authenticator app (two-factor plugin; adds its table). */
export const TWO_FACTOR_ISSUER = BRAND_NAME;
