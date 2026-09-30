import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { env } from "@/env";
import { defaultLocale, isLocale } from "@/i18n/locales";
import { ac, roles } from "@/lib/permissions";
import { sendEmailLater } from "@/server/email/send-later";
import { invitationEmail, resetPasswordEmail } from "@/server/email/templates";

import {
  authIdStrategy,
  organizationAdditionalFields,
  userAdditionalFields,
} from "./schema-options";

const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const auth = betterAuth({
  appName: "PRODUCT_NAME",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: { database: { generateId: authIdStrategy } },
  user: { additionalFields: userAdditionalFields },
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmailLater(resetPasswordEmail({ to: user.email, url }));
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Land every new session in the user's first organization.
        before: async (session) => {
          const [first] = await db
            .select({ organizationId: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, session.userId))
            .orderBy(asc(schema.member.createdAt))
            .limit(1);
          return { data: { ...session, activeOrganizationId: first?.organizationId ?? null } };
        },
      },
    },
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "owner",
      invitationExpiresIn: INVITATION_TTL_SECONDS,
      cancelPendingInvitationsOnReInvite: true,
      schema: { organization: { additionalFields: organizationAdditionalFields } },
      sendInvitationEmail: async ({ id, email, organization: org, inviter }) => {
        const inviterLocale = (inviter.user as { locale?: unknown }).locale;
        const locale = isLocale(inviterLocale) ? inviterLocale : defaultLocale;
        await sendEmailLater(
          invitationEmail({
            to: email,
            organization: org.name,
            inviter: inviter.user.name,
            url: `${env.BETTER_AUTH_URL}/${locale}/accept-invitation/${id}`,
          }),
        );
      },
    }),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
