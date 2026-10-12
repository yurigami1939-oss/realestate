import "server-only";

import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { cache } from "react";

import { defaultLocale, isLocale } from "@/i18n/locales";
import { redirect } from "@/i18n/navigation";
import { AppError } from "@/lib/result";
import { OPERATOR_ROLE } from "@/server/auth/schema-options";
import { getSession } from "@/server/auth/session";

import type { OperatorCtx } from "./context";

export type Operator = Required<OperatorCtx> & { userId: string; twoFactorEnabled: boolean };

/** The signed-in operator (role `operator`, CLAUDE.console.md §9), or null. Cached per request. */
export const getOperator = cache(async (): Promise<Operator | null> => {
  const session = await getSession();
  const role = (session?.user as { role?: string | null } | undefined)?.role;
  if (!session || role !== OPERATOR_ROLE) return null;
  const locale = session.user.locale;
  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    locale: isLocale(locale) ? locale : defaultLocale,
    twoFactorEnabled: session.user.twoFactorEnabled === true,
  };
});

/**
 * Console pages: an operator, else 404 (nothing tells the console exists); an operator without
 * two-factor authentication only reaches the security page (`enrolling`), where it enrols.
 */
export async function requireOperator(options: { enrolling?: boolean } = {}): Promise<Operator> {
  const operator = await getOperator();
  if (!operator) notFound();
  if (!operator.twoFactorEnabled && !options.enrolling) {
    return redirect({ href: "/console/security", locale: await getLocale() });
  }
  return operator;
}

/** Console actions: an operator with two-factor authentication, else an error. */
export async function getOperatorCtx(): Promise<Operator> {
  const operator = await getOperator();
  if (!operator) throw new AppError("FORBIDDEN");
  if (!operator.twoFactorEnabled) throw new AppError("FORBIDDEN", "console.errors.twoFactor");
  return operator;
}
