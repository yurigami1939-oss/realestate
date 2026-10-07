import "server-only";

import { asc, eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { buyer, organizationSetting, project, reservationBuyer } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  type HousingAidSettings,
  housingAidCheck,
  housingAidSettings,
  storeHousingAid,
} from "@/lib/housing-aid";
import { isUuid } from "@/lib/ids";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleReservation } from "@/server/sales/access";

import type { housingAidSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

export async function loadHousingAid(tx: Tx, orgId: string): Promise<HousingAidSettings> {
  const [row] = await tx
    .select({ aid: organizationSetting.housingAid })
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, orgId));
  return housingAidSettings(row?.aid ?? null);
}

/** The LPA settings (gérant). */
export async function getHousingAidSettings(ctx: TenantCtx) {
  assertCan(ctx, "organization:update");
  return withTenant(ctx, (tx) => loadHousingAid(tx, ctx.orgId));
}

/**
 * Saves the LPA settings as a whole (`organization:update`): the SNMG, the household income
 * ceiling and the CNL aid and subsidised rate brackets, as the decrees in force set them.
 * Audited `organization.housing_aid`.
 */
export async function saveHousingAid(ctx: TenantCtx, input: In<typeof housingAidSchema>) {
  assertCan(ctx, "organization:update");
  const settings: HousingAidSettings = {
    snmg: input.snmg,
    lpaMaxMultiple: input.lpaMaxMultiple,
    cnlBrackets: input.cnlBrackets,
    rateBrackets: input.rateBrackets.map((b) => ({ maxMultiple: b.maxMultiple, rateBp: b.rate })),
  };
  const stored = storeHousingAid(housingAidSettings(storeHousingAid(settings)));
  await withTenant(ctx, async (tx) => {
    const before = storeHousingAid(await loadHousingAid(tx, ctx.orgId));
    await tx
      .insert(organizationSetting)
      .values({ organizationId: ctx.orgId, housingAid: stored, updatedBy: ctx.userId })
      .onConflictDoUpdate({
        target: organizationSetting.organizationId,
        set: { housingAid: stored, updatedBy: ctx.userId, updatedAt: new Date() },
      });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.housing_aid",
      entityType: "organization",
      entityId: ctx.orgId,
      before,
      after: stored,
    });
  });
}

/**
 * The LPA check of a visible sale in an LPA project (null otherwise): the household of its main
 * buyer — monthly income, declared home ownership and earlier aid — against the organization's
 * settings, with the CNL aid and the subsidised rate of its bracket. Warnings only.
 */
export async function getSaleHousingAid(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return null;
  return withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, reservationId);
    const [program] = await tx
      .select({ housingProgram: project.housingProgram })
      .from(project)
      .where(eq(project.id, sale.projectId));
    if (program?.housingProgram !== "lpa") return null;
    const [main] = await tx
      .select({
        buyerId: buyer.id,
        lastName: buyer.lastName,
        firstName: buyer.firstName,
        income: buyer.householdIncome,
        ownsHome: buyer.ownsHome,
        previousAid: buyer.previousHousingAid,
      })
      .from(reservationBuyer)
      .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
      .where(eq(reservationBuyer.reservationId, sale.id))
      .orderBy(asc(reservationBuyer.position))
      .limit(1);
    const settings = await loadHousingAid(tx, ctx.orgId);
    return {
      buyer: main ?? null,
      snmg: settings.snmg,
      check: housingAidCheck(
        {
          income: main?.income ?? null,
          ownsHome: main?.ownsHome ?? null,
          previousAid: main?.previousAid ?? null,
        },
        settings,
      ),
    };
  });
}

export type SaleHousingAid = NonNullable<Awaited<ReturnType<typeof getSaleHousingAid>>>;
