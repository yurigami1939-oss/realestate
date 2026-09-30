import "server-only";

import { eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { organization, organizationSetting } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type { companySettingsSchema } from "./schemas";

export const DEFAULT_QUOTATION_VALIDITY_DAYS = 15;

/** Legal identity and sales settings of the organization (defaults when never saved). */
export async function loadCompanyProfile(tx: Tx, orgId: string) {
  // `organization` is Better Auth's tenant table (no RLS): always filter on the session's id.
  const [org] = await tx
    .select({
      name: organization.name,
      legalName: organization.legalName,
      address: organization.address,
      wilaya: organization.wilaya,
      phone: organization.phone,
      rcNumber: organization.rcNumber,
      nif: organization.nif,
      nis: organization.nis,
      aiNumber: organization.aiNumber,
    })
    .from(organization)
    .where(eq(organization.id, orgId));
  if (!org) throw new AppError("NOT_FOUND");
  const [setting] = await tx
    .select({ quotationValidityDays: organizationSetting.quotationValidityDays })
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, orgId));
  return {
    ...org,
    quotationValidityDays: setting?.quotationValidityDays ?? DEFAULT_QUOTATION_VALIDITY_DAYS,
  };
}

export type CompanyProfile = Awaited<ReturnType<typeof loadCompanyProfile>>;

export async function getCompanySettings(ctx: TenantCtx) {
  assertCan(ctx, "organization:update");
  return withTenant(ctx, (tx) => loadCompanyProfile(tx, ctx.orgId));
}

/** Saves the legal identity and settings (gérant only); audited. */
export async function updateCompanySettings(
  ctx: TenantCtx,
  input: z.output<typeof companySettingsSchema>,
) {
  assertCan(ctx, "organization:update");
  await withTenant(ctx, async (tx) => {
    const before = await loadCompanyProfile(tx, ctx.orgId);
    const { quotationValidityDays, ...identity } = input;
    await tx.update(organization).set(identity).where(eq(organization.id, ctx.orgId));
    await tx
      .insert(organizationSetting)
      .values({ organizationId: ctx.orgId, quotationValidityDays, updatedBy: ctx.userId })
      .onConflictDoUpdate({
        target: organizationSetting.organizationId,
        set: { quotationValidityDays, updatedBy: ctx.userId, updatedAt: new Date() },
      });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.update",
      entityType: "organization",
      entityId: ctx.orgId,
      before,
      after: input,
    });
  });
}
