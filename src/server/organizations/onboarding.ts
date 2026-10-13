"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";

import { AppError, err, ok, type Result } from "@/lib/result";
import { auth } from "@/server/auth/auth";
import { provisionedOrganizationSchema } from "@/server/auth/schemas";
import { getSession } from "@/server/auth/session";
import { completeProvision, findLiveProvision } from "@/server/console/provisions";

/**
 * The onboarding with a provision link (CLAUDE.console.md §8): for the signed-in e-mail the link
 * was sent to, creates the organization (its user becomes the gérant), gives it its account — a
 * new client's pilot or a place in its client's account — and opens it. If the account cannot be
 * completed, the organization exists without entitlement (read-only, a console to-do).
 */
export async function createProvisionedOrganizationAction(
  raw: z.input<typeof provisionedOrganizationSchema>,
): Promise<Result<{ organizationId: string }>> {
  try {
    const parsed = provisionedOrganizationSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("VALIDATION");
    const { token, name, slug } = parsed.data;
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED");
    const provision = await findLiveProvision(token);
    if (!provision) throw new AppError("CONFLICT", "console.errors.provisionClosed");
    if (provision.email !== session.user.email.trim().toLowerCase()) {
      throw new AppError("FORBIDDEN", "console.errors.provisionEmail");
    }
    const requestHeaders = await headers();
    let organizationId: string;
    try {
      const created = await auth.api.createOrganization({
        headers: requestHeaders,
        body: { name, slug, legalName: provision.legalName },
      });
      if (!created) throw new AppError("UNEXPECTED");
      organizationId = created.id;
    } catch (error) {
      const code = error instanceof APIError ? (error.body as { code?: string })?.code : null;
      if (code === "ORGANIZATION_SLUG_ALREADY_TAKEN" || code === "ORGANIZATION_ALREADY_EXISTS") {
        throw new AppError("CONFLICT", "onboarding.slugTaken");
      }
      throw error;
    }
    try {
      await completeProvision({ token, organizationId, email: session.user.email });
    } catch (error) {
      console.error(`[onboarding] provision not completed for ${organizationId}`, error);
    }
    await auth.api.setActiveOrganization({ headers: requestHeaders, body: { organizationId } });
    return ok({ organizationId });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError) return err(error);
    console.error("[onboarding] unexpected error", error);
    return err(new AppError("UNEXPECTED"));
  }
}
