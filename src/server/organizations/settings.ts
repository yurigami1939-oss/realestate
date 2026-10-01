import "server-only";

import { eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { organization, organizationSetting } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { salesSettingDefaults, type SalesSettings, type VspLimits } from "@/lib/sales";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type { companySettingsSchema } from "./schemas";

export const DEFAULT_QUOTATION_VALIDITY_DAYS = 15;

/** Sales settings of the organization, with the defaults when never saved (CLAUDE.md §12). */
export async function loadSalesSettings(
  tx: Tx,
  orgId: string,
): Promise<SalesSettings & { quotationValidityDays: number }> {
  const [row] = await tx
    .select()
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, orgId));
  if (!row) {
    return {
      ...salesSettingDefaults,
      quotationValidityDays: DEFAULT_QUOTATION_VALIDITY_DAYS,
      vspLimits: {},
    };
  }
  return {
    quotationValidityDays: row.quotationValidityDays,
    optionHours: row.optionHours,
    paymentCallDelayDays: row.paymentCallDelayDays,
    withdrawalRetentionBp: row.withdrawalRetentionBp,
    penaltyMonthlyRateBp: row.penaltyMonthlyRateBp,
    penaltyGraceDays: row.penaltyGraceDays,
    penaltyCapBp: row.penaltyCapBp,
    defaultCommissionRateBp: row.defaultCommissionRateBp,
    vspLimits: row.vspLimits,
  };
}

/** Legal identity and settings of the organization (defaults when never saved). */
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
  return { ...org, ...(await loadSalesSettings(tx, orgId)) };
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
    const {
      quotationValidityDays,
      optionHours,
      paymentCallDelayDays,
      withdrawalRetention,
      penaltyMonthlyRate,
      penaltyGraceDays,
      penaltyCap,
      defaultCommissionRate,
      vspLimitSigning,
      vspLimitFoundations,
      vspLimitStructure,
      vspLimitCompletion,
      ...identity
    } = input;
    const vspLimits: VspLimits = Object.fromEntries(
      Object.entries({
        signing: vspLimitSigning,
        foundations: vspLimitFoundations,
        structure: vspLimitStructure,
        completion: vspLimitCompletion,
      }).filter((entry): entry is [string, number] => entry[1] !== null),
    );
    const settings = {
      quotationValidityDays,
      optionHours,
      paymentCallDelayDays,
      withdrawalRetentionBp: withdrawalRetention,
      penaltyMonthlyRateBp: penaltyMonthlyRate,
      penaltyGraceDays,
      penaltyCapBp: penaltyCap,
      defaultCommissionRateBp: defaultCommissionRate,
      vspLimits,
      updatedBy: ctx.userId,
    };

    await tx.update(organization).set(identity).where(eq(organization.id, ctx.orgId));
    await tx
      .insert(organizationSetting)
      .values({ organizationId: ctx.orgId, ...settings })
      .onConflictDoUpdate({
        target: organizationSetting.organizationId,
        set: { ...settings, updatedAt: new Date() },
      });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.update",
      entityType: "organization",
      entityId: ctx.orgId,
      before,
      after: { ...identity, ...settings },
    });
  });
}
