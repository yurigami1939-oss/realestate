import "server-only";

import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { type Module, moduleOn } from "@/lib/modules";
import { can, isPortalOnly, type Permission } from "@/lib/permissions";
import { AppError } from "@/lib/result";

import { getTenantCtx, type TenantCtx } from "./session";

/**
 * For Server Components: like getTenantCtx, but redirects to sign-in or onboarding instead of
 * throwing (pages render in parallel with the layout guard, so they must not rely on it).
 */
export async function requireTenantCtx(): Promise<TenantCtx> {
  let ctx: TenantCtx;
  try {
    ctx = await getTenantCtx();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const locale = await getLocale();
    const href = error.code === "UNAUTHENTICATED" ? "/sign-in" : "/onboarding";
    return redirect({ href, locale });
  }
  // Portal accounts never see the back office.
  if (isPortalOnly(ctx.roles)) return redirect({ href: "/portal", locale: await getLocale() });
  return ctx;
}

/**
 * Page-level permission: users who may not see a page get a 404 (no existence leak) — also when
 * the page belongs to a module the organization does not have (CLAUDE.console.md §5).
 */
export async function requirePermission(
  permission: Permission,
  module?: Module,
): Promise<TenantCtx> {
  const ctx = await requireTenantCtx();
  if (!can(ctx, permission)) notFound();
  if (module && !moduleOn(ctx.access?.modules, module)) notFound();
  return ctx;
}

/**
 * Page-level module (CLAUDE.console.md §5): pages of a module the organization does not have
 * answer 404, like `requirePermission`.
 */
export async function requireModule(module: Module): Promise<TenantCtx> {
  const ctx = await requireTenantCtx();
  if (!moduleOn(ctx.access?.modules, module)) notFound();
  return ctx;
}
