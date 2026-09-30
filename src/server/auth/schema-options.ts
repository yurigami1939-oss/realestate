/**
 * Better Auth options that shape the database schema. Shared by the runtime config
 * (src/server/auth/auth.ts) and the schema generator config (scripts/auth-schema.config.ts).
 * After changing anything here run `pnpm auth:generate` then `pnpm db:generate`.
 */

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
