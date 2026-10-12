import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { env } from "@/env";
import { defaultLocale, isLocale } from "@/i18n/locales";
import { BRAND_NAME } from "@/lib/brand";
import { ac, parseRoles, roles } from "@/lib/permissions";
import { recordAudit } from "@/server/audit/record-audit";
import { startPilotForNewOrganization } from "@/server/console/accounts";
import { sendEmailLater } from "@/server/email/send-later";
import { invitationEmail, resetPasswordEmail } from "@/server/email/templates";
import { linkPortalAccount } from "@/server/portal/link";

import {
  authIdStrategy,
  OPERATOR_ROLE,
  organizationAdditionalFields,
  SUPPORT_SESSION_SECONDS,
  TWO_FACTOR_ISSUER,
  userAdditionalFields,
} from "./schema-options";

const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const auth = betterAuth({
  appName: BRAND_NAME,
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
  hooks: {
    // The demo deployment creates no account (CLAUDE.console.md §13): visitors use the demo
    // accounts. Only requests are refused, the seed's own calls (no request) still sign up.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email" && ctx.request && env.DEMO_MODE === true) {
        throw new APIError("FORBIDDEN", { code: "SIGNUP_CLOSED", message: "Sign-up is closed." });
      }
      if (!ctx.request) return;
      // Operators (CLAUDE.console.md §9) act through the console only after enrolling in 2FA, and
      // are never members of a tenant.
      // (Leaving a support session is the impersonated member's request: let it through.)
      const operatorPaths =
        ctx.path.startsWith("/admin/") && ctx.path !== "/admin/stop-impersonating";
      const memberPaths =
        ctx.path === "/organization/create" || ctx.path === "/organization/accept-invitation";
      if (!operatorPaths && !memberPaths) return;
      const session = await getSessionFromCtx(ctx);
      const role = (session?.user as { role?: string | null } | undefined)?.role;
      if (operatorPaths && !session?.user.twoFactorEnabled) {
        throw new APIError("FORBIDDEN", {
          code: "OPERATOR_2FA_REQUIRED",
          message: "Two-factor first.",
        });
      }
      if (memberPaths && role === OPERATOR_ROLE) {
        throw new APIError("FORBIDDEN", {
          code: "OPERATOR_NOT_MEMBER",
          message: "Operators join no organization.",
        });
      }
    }),
    // An organization created from the onboarding (a request) gets its client account
    // (CLAUDE.console.md §8); the seed's own calls open theirs.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/organization/create" || !ctx.request) return;
      const created: unknown = ctx.context.returned;
      if (!created || isAPIError(created) || typeof created !== "object" || !("id" in created)) {
        return;
      }
      await startPilotForNewOrganization(String(created.id));
    }),
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
      // Membership changes made by the user themself; other member changes are audited in
      // src/server/organizations/service.ts, where the acting user is known.
      organizationHooks: {
        afterCreateOrganization: async ({ organization: org, user }) => {
          await withTenant({ orgId: org.id }, (tx) =>
            recordAudit(
              tx,
              { orgId: org.id },
              {
                actorUserId: user.id,
                action: "organization.create",
                entityType: "organization",
                entityId: org.id,
                after: { name: org.name, slug: org.slug },
              },
            ),
          );
        },
        afterAcceptInvitation: async ({ organization: org, member: joined, user }) => {
          // A portal invitation: the records waiting on this e-mail join the account.
          if (parseRoles(joined.role).includes("resident")) {
            await linkPortalAccount(org.id, { id: user.id, email: user.email });
          }
          await withTenant({ orgId: org.id }, (tx) =>
            recordAudit(
              tx,
              { orgId: org.id },
              {
                actorUserId: user.id,
                action: "member.join",
                entityType: "member",
                entityId: joined.id,
                after: { email: user.email, roles: parseRoles(joined.role) },
              },
            ),
          );
        },
      },
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
    // Two-factor authentication (TOTP app + backup codes), opted in by each member.
    twoFactor({ issuer: TWO_FACTOR_ISSUER }),
    // The operators' console (CLAUDE.console.md §9): role `operator`, granted by `console:grant`.
    admin({
      adminRoles: [OPERATOR_ROLE],
      roles: { user: userAc, [OPERATOR_ROLE]: adminAc },
      impersonationSessionDuration: SUPPORT_SESSION_SECONDS,
    }),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
