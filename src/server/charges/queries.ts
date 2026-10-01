import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  budget,
  budgetLine,
  building,
  chargeCategory,
  chargeCategoryUnit,
  project,
  residence,
  residenceUnit,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";

/**
 * Charges page of a residence: its categories (with their key's building or units), the
 * budget of `year` (or last year's amounts to start from) and the other budget years.
 */
export async function getChargesSetup(ctx: TenantCtx, residenceId: string, year: number) {
  assertCan(ctx, "charge:read");
  if (!isUuid(residenceId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ residence, projectName: project.name })
      .from(residence)
      .innerJoin(project, eq(project.id, residence.projectId))
      .where(and(eq(residence.id, residenceId), isNull(residence.deletedAt)));
    if (!row) return null;

    const categories = await tx
      .select({
        id: chargeCategory.id,
        name: chargeCategory.name,
        nameAr: chargeCategory.nameAr,
        key: chargeCategory.key,
        weighting: chargeCategory.weighting,
        buildingId: chargeCategory.buildingId,
        buildingCode: building.code,
      })
      .from(chargeCategory)
      .leftJoin(building, eq(building.id, chargeCategory.buildingId))
      .where(and(eq(chargeCategory.residenceId, residenceId), isNull(chargeCategory.deletedAt)))
      .orderBy(asc(chargeCategory.position), asc(chargeCategory.name));
    const customUnits =
      categories.length === 0
        ? []
        : await tx
            .select({
              categoryId: chargeCategoryUnit.categoryId,
              unitId: chargeCategoryUnit.unitId,
            })
            .from(chargeCategoryUnit)
            .where(
              inArray(
                chargeCategoryUnit.categoryId,
                categories.map((c) => c.id),
              ),
            );

    const units = await tx
      .select({
        unitId: unit.id,
        code: unit.code,
        buildingId: unit.buildingId,
        share: residenceUnit.share,
      })
      .from(residenceUnit)
      .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
      .where(eq(residenceUnit.residenceId, residenceId))
      .orderBy(asc(unit.code));
    const buildings = await tx
      .select({ id: building.id, code: building.code, name: building.name })
      .from(building)
      .where(and(eq(building.projectId, row.residence.projectId), isNull(building.deletedAt)))
      .orderBy(asc(building.code));

    const budgets = await tx
      .select({
        id: budget.id,
        year: budget.year,
        status: budget.status,
        frequency: budget.frequency,
        reserveFundBp: budget.reserveFundBp,
        approvedAt: budget.approvedAt,
        notes: budget.notes,
      })
      .from(budget)
      .where(eq(budget.residenceId, residenceId))
      .orderBy(desc(budget.year));
    const current = budgets.find((b) => b.year === year) ?? null;
    // Amounts shown: the year's budget, else the latest approved one before it, to start from.
    const source = current ?? budgets.find((b) => b.year < year && b.status === "approved") ?? null;
    const lines = source
      ? await tx
          .select({ categoryId: budgetLine.categoryId, amount: budgetLine.amount })
          .from(budgetLine)
          .where(eq(budgetLine.budgetId, source.id))
      : [];

    return {
      residence: { ...row.residence, projectName: row.projectName },
      categories: categories.map((c) => ({
        ...c,
        unitIds: customUnits.filter((u) => u.categoryId === c.id).map((u) => u.unitId),
      })),
      units,
      buildings,
      budgets,
      budget: current,
      /** Year the amounts come from (null: nothing budgeted yet). */
      amountsFrom: source?.year ?? null,
      lines,
    };
  });
}

export type ChargesSetup = NonNullable<Awaited<ReturnType<typeof getChargesSetup>>>;
export type ChargeCategoryRow = ChargesSetup["categories"][number];
