import "server-only";

import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { can, type Permission } from "@/lib/permissions";
import { AppError } from "@/lib/result";

import { getTenantCtx, type TenantCtx } from "./session";

/**
 * For Server Components: like getTenantCtx, but redirects to sign-in or onboarding instead of
 * throwing (pages render in parallel with the layout guard, so they must not rely on it).
 */
export async function requireTenantCtx(): Promise<TenantCtx> {
  try {
    return await getTenantCtx();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const locale = await getLocale();
    const href = error.code === "UNAUTHENTICATED" ? "/sign-in" : "/onboarding";
    return redirect({ href, locale });
  }
}

/** Page-level permission: users who may not see a page get a 404 (no existence leak). */
export async function requirePermission(permission: Permission): Promise<TenantCtx> {
  const ctx = await requireTenantCtx();
  if (!can(ctx.roles, permission)) notFound();
  return ctx;
}
