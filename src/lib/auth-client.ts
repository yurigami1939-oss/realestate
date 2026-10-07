"use client";

import {
  inferAdditionalFields,
  inferOrgAdditionalFields,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { auth } from "@/server/auth/auth";

import { ac, roles } from "./permissions";

/** Browser client for Better Auth (sign-in, sign-up, organizations, invitations, 2FA). */
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    organizationClient({ ac, roles, schema: inferOrgAdditionalFields<typeof auth>() }),
    // The sign-in form handles `twoFactorRedirect` itself (the code page keeps `next`).
    twoFactorClient(),
  ],
});
