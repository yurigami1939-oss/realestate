import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { file, organization, organizationSetting } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { salesSettingDefaults, type SalesSettings, type VspLimits } from "@/lib/sales";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";
import { getObjectBytes } from "@/server/files/storage";

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
    deliveryPenaltyMonthlyRateBp: row.deliveryPenaltyMonthlyRateBp,
    deliveryPenaltyCapBp: row.deliveryPenaltyCapBp,
    formalNoticeDays: row.formalNoticeDays,
    formalNoticesRequired: row.formalNoticesRequired,
    terminationRetentionBp: row.terminationRetentionBp,
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
  const [setting] = await tx
    .select({
      logoFileId: organizationSetting.logoFileId,
      fgcmpiNumber: organizationSetting.fgcmpiNumber,
      emailDocuments: organizationSetting.emailDocuments,
    })
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, orgId));
  return {
    ...org,
    ...(await loadSalesSettings(tx, orgId)),
    logoFileId: setting?.logoFileId ?? null,
    fgcmpiNumber: setting?.fgcmpiNumber ?? null,
    emailDocuments: setting?.emailDocuments ?? false,
  };
}

export type CompanyProfile = Awaited<ReturnType<typeof loadCompanyProfile>>;
/** The legal identity printed on documents, with the logo as a data URI when there is one. */
export type CompanyIdentity = Pick<
  CompanyProfile,
  "name" | "legalName" | "address" | "wilaya" | "phone" | "rcNumber" | "nif" | "nis" | "aiNumber"
> & { logo?: string | null };

/**
 * Company profile for the PDF templates: the logo is read from storage and embedded as a data
 * URI (documents are rendered offline by Chromium in the worker).
 */
export async function loadCompanyLetterhead(tx: Tx, orgId: string) {
  const profile = await loadCompanyProfile(tx, orgId);
  if (!profile.logoFileId) return { ...profile, logo: null };
  const [logo] = await tx
    .select({ storageKey: file.storageKey, contentType: file.contentType })
    .from(file)
    .where(and(eq(file.id, profile.logoFileId), isNull(file.deletedAt)));
  if (!logo) return { ...profile, logo: null };
  const bytes = await getObjectBytes(logo.storageKey);
  return {
    ...profile,
    logo: `data:${logo.contentType};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

export type CompanyLetterhead = Awaited<ReturnType<typeof loadCompanyLetterhead>>;

/**
 * Gérant: the company logo (PNG/JPEG, checked by magic bytes), printed on the documents issued
 * afterwards; the previous logo file is soft-deleted. Audited.
 */
export async function setCompanyLogo(ctx: TenantCtx, input: { upload: Upload }) {
  assertCan(ctx, "organization:update");
  const contentType = checkUpload("organization.logo", input.upload);
  return withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ logoFileId: organizationSetting.logoFileId })
      .from(organizationSetting)
      .where(eq(organizationSetting.organizationId, ctx.orgId))
      .for("update");
    const stored = await storeFile(tx, ctx, {
      entityType: "organization",
      entityId: ctx.orgId,
      upload: input.upload,
      contentType,
    });
    await tx
      .insert(organizationSetting)
      .values({ organizationId: ctx.orgId, logoFileId: stored.id, updatedBy: ctx.userId })
      .onConflictDoUpdate({
        target: organizationSetting.organizationId,
        set: { logoFileId: stored.id, updatedBy: ctx.userId, updatedAt: new Date() },
      });
    if (current?.logoFileId) await discardFile(tx, current.logoFileId);
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.logo",
      entityType: "organization",
      entityId: ctx.orgId,
      before: { logoFileId: current?.logoFileId ?? null },
      after: { logoFileId: stored.id, fileName: input.upload.fileName },
    });
    return { fileId: stored.id };
  });
}

/** Gérant: documents are issued without a logo again. Audited. */
export async function removeCompanyLogo(ctx: TenantCtx) {
  assertCan(ctx, "organization:update");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ logoFileId: organizationSetting.logoFileId })
      .from(organizationSetting)
      .where(eq(organizationSetting.organizationId, ctx.orgId))
      .for("update");
    if (!current?.logoFileId) return;
    await tx
      .update(organizationSetting)
      .set({ logoFileId: null, updatedBy: ctx.userId })
      .where(eq(organizationSetting.organizationId, ctx.orgId));
    await discardFile(tx, current.logoFileId);
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.logo",
      entityType: "organization",
      entityId: ctx.orgId,
      before: { logoFileId: current.logoFileId },
      after: { logoFileId: null },
    });
  });
}

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
      deliveryPenaltyMonthlyRate,
      deliveryPenaltyCap,
      formalNoticeDays,
      formalNoticesRequired,
      terminationRetention,
      fgcmpiNumber,
      emailDocuments,
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
      deliveryPenaltyMonthlyRateBp: deliveryPenaltyMonthlyRate,
      deliveryPenaltyCapBp: deliveryPenaltyCap,
      formalNoticeDays,
      formalNoticesRequired,
      terminationRetentionBp: terminationRetention,
      fgcmpiNumber,
      emailDocuments,
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

/** Sales settings for any member (option duration shown in dialogs, etc.). */
export async function getSalesSettings(ctx: TenantCtx) {
  return withTenant(ctx, (tx) => loadSalesSettings(tx, ctx.orgId));
}
