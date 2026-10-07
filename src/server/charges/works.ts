import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  assemblyResolution,
  chargeCategory,
  chargeCategoryUnit,
  chargePeriod,
  generalAssembly,
  residenceUnit,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { buildChargeCalls } from "@/lib/charges";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";

import { mainCoOwners, RESERVE_LABEL, writeCalls } from "./calls";
import type { issueWorksCallSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** Resolutions adopted by the residence's closed assemblies, latest first (works to call). */
async function adoptedResolutions(tx: Tx, residenceId: string) {
  return tx
    .select({
      id: assemblyResolution.id,
      title: assemblyResolution.title,
      titleAr: assemblyResolution.titleAr,
      position: assemblyResolution.position,
      heldOn: generalAssembly.heldOn,
    })
    .from(assemblyResolution)
    .innerJoin(generalAssembly, eq(generalAssembly.id, assemblyResolution.assemblyId))
    .where(
      and(
        eq(generalAssembly.residenceId, residenceId),
        eq(generalAssembly.status, "closed"),
        eq(assemblyResolution.adopted, true),
      ),
    )
    .orderBy(desc(generalAssembly.heldOn), asc(assemblyResolution.position));
}

/** What the exceptional call dialog offers: the residence's categories and voted works. */
export async function getWorksCallChoices(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "charge:create");
  return withTenant(ctx, async (tx) => ({
    categories: await tx
      .select({ id: chargeCategory.id, name: chargeCategory.name })
      .from(chargeCategory)
      .where(and(eq(chargeCategory.residenceId, residenceId), isNull(chargeCategory.deletedAt)))
      .orderBy(asc(chargeCategory.position), asc(chargeCategory.name)),
    resolutions: await adoptedResolutions(tx, residenceId),
  }));
}

/**
 * An exceptional call (`charge:create`; CLAUDE.md §7 Residence charges): works voted by the
 * general assembly, or any one-off expense, called once from the co-owners — the amount split
 * by the key of a charge category of the residence (so the budget report counts it there), one
 * numbered call ADC-… per unit like a budget period, no reserve fund part. A resolution cited
 * must have been adopted by a closed assembly of the residence. Cancelled like a period.
 */
export async function issueWorksCall(ctx: TenantCtx, input: In<typeof issueWorksCallSchema>) {
  assertCan(ctx, "charge:create");
  if (input.issuedOn > todayInAlgiers()) throw invalid("issuedOn", "charges.errors.futureDate");
  if (input.dueOn < input.issuedOn) throw invalid("dueOn", "charges.errors.dueBeforeIssue");
  return withTenant(ctx, async (tx) => {
    const home = await loadResidence(tx, input.residenceId, { forUpdate: true });
    const [category] = await tx
      .select()
      .from(chargeCategory)
      .where(
        and(
          eq(chargeCategory.id, input.categoryId),
          eq(chargeCategory.residenceId, home.id),
          isNull(chargeCategory.deletedAt),
        ),
      );
    if (!category) throw invalid("categoryId", "charges.errors.categoryNotFound");
    if (input.resolutionId) {
      const voted = await adoptedResolutions(tx, home.id);
      if (!voted.some((r) => r.id === input.resolutionId)) {
        throw invalid("resolutionId", "charges.errors.resolutionNotAdopted");
      }
    }
    const units = await tx
      .select({
        unitId: residenceUnit.unitId,
        buildingId: unit.buildingId,
        share: residenceUnit.share,
      })
      .from(residenceUnit)
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .where(eq(residenceUnit.residenceId, home.id))
      .orderBy(asc(unit.code));
    const custom = await tx
      .select({ unitId: chargeCategoryUnit.unitId })
      .from(chargeCategoryUnit)
      .where(inArray(chargeCategoryUnit.categoryId, [category.id]));
    // The whole amount at once: a « yearly » part of an « annual » amount, no reserve fund.
    const split = buildChargeCalls({
      units,
      categories: [
        {
          ...category,
          name: input.title,
          nameAr: input.titleAr,
          unitIds: custom.map((c) => c.unitId),
          annual: input.amount,
        },
      ],
      frequency: "yearly",
      periodIndex: 1,
      reserveFundBp: 0,
      reserveLabel: RESERVE_LABEL,
    });
    if (split.problems.length > 0) throw new AppError("CONFLICT", "charges.errors.cannotSplit");
    if (split.calls.length === 0) throw new AppError("CONFLICT", "charges.errors.nothingToCall");

    const [period] = await tx
      .insert(chargePeriod)
      .values({
        organizationId: ctx.orgId,
        residenceId: home.id,
        kind: "works",
        title: input.title,
        titleAr: input.titleAr,
        categoryId: category.id,
        resolutionId: input.resolutionId,
        year: Number(input.issuedOn.slice(0, 4)),
        issuedOn: input.issuedOn,
        dueOn: input.dueOn,
        total: split.total,
        reserve: 0n,
        callCount: split.calls.length,
        issuedBy: ctx.userId,
      })
      .returning({ id: chargePeriod.id });
    if (!period) throw new Error("issueWorksCall: no period returned");
    await writeCalls(tx, ctx, {
      residenceId: home.id,
      periodId: period.id,
      calls: split.calls,
      owners: await mainCoOwners(tx, home.id, input.issuedOn),
      issuedOn: input.issuedOn,
      dueOn: input.dueOn,
    });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_period.issue_works",
      entityType: "charge_period",
      entityId: period.id,
      after: {
        residence: home.name,
        title: input.title,
        category: category.name,
        resolutionId: input.resolutionId,
        issuedOn: input.issuedOn,
        dueOn: input.dueOn,
        calls: split.calls.length,
        total: split.total,
      },
    });
    return { periodId: period.id, calls: split.calls.length, total: split.total };
  });
}
