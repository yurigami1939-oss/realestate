/**
 * Minimal Better Auth config used only by `pnpm auth:generate` to emit src/db/schema/auth.ts.
 * Must mirror the schema-affecting options of src/server/auth/auth.ts.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";

import {
  authIdStrategy,
  organizationAdditionalFields,
  TWO_FACTOR_ISSUER,
  userAdditionalFields,
} from "../src/server/auth/schema-options";

export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "pg" }),
  advanced: { database: { generateId: authIdStrategy } },
  emailAndPassword: { enabled: true },
  user: { additionalFields: userAdditionalFields },
  plugins: [
    organization({ schema: { organization: { additionalFields: organizationAdditionalFields } } }),
    twoFactor({ issuer: TWO_FACTOR_ISSUER }),
  ],
});
