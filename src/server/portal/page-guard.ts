import "server-only";

import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { AppError } from "@/lib/result";

import { getPortalCtx, type PortalCtx } from "./context";

/** For portal pages: signed-out users go to sign-in, staff to their back office. */
export async function requirePortalCtx(): Promise<PortalCtx> {
  try {
    return await getPortalCtx();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const locale = await getLocale();
    const href =
      error.code === "UNAUTHENTICATED"
        ? "/sign-in"
        : error.messageKey === "errors.noActiveOrganization"
          ? "/onboarding"
          : "/dashboard";
    return redirect({ href, locale });
  }
}
