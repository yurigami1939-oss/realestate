import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  budget,
  budgetLine,
  building,
  chargeCategory,
  chargeCategoryUnit,
  residenceUnit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";

import type { createChargeCategorySchema, updateChargeCategorySchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;
type CategoryInput = In<typeof createChargeCategorySchema>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** The building of a `per_building` key belongs to the residence's project; custom units to it. */
async function checkKeyTargets(
  tx: Tx,
  target: { id: string; projectId: string },
  input: Pick<CategoryInput, "key" | "buildingId" | "unitIds">,
) {
  if (input.key === "per_building" && input.buildingId) {
    const [row] = await tx
      .select({ id: building.id })
      .from(building)
      .where(
        and(
          eq(building.id, input.buildingId),
          eq(building.projectId, target.projectId),
          isNull(building.deletedAt),
        ),
      );
    if (!row) throw invalid("buildingId", "charges.errors.buildingNotInResidence");
  }
  if (input.key === "custom") {
    const unitIds = [...new Set(input.unitIds)];
    const rows = await tx
      .select({ unitId: residenceUnit.unitId })
      .from(residenceUnit)
      .where(and(eq(residenceUnit.residenceId, target.id), inArray(residenceUnit.unitId, unitIds)));
    if (rows.length !== unitIds.length) {
      throw invalid("unitIds", "residences.errors.unitNotInResidence");
    }
  }
}

async function writeCustomUnits(
  tx: Tx,
  ctx: TenantCtx,
  residenceId: string,
  categoryId: string,
  input: Pick<CategoryInput, "key" | "unitIds">,
) {
  await tx.delete(chargeCategoryUnit).where(eq(chargeCategoryUnit.categoryId, categoryId));
  if (input.key !== "custom") return;
  await tx.insert(chargeCategoryUnit).values(
    [...new Set(input.unitIds)].map((unitId) => ({
      organizationId: ctx.orgId,
      residenceId,
      categoryId,
      unitId,
    })),
  );
}

const fieldsOf = (input: CategoryInput | In<typeof updateChargeCategorySchema>) => ({
  name: input.name,
  nameAr: input.nameAr,
  key: input.key,
  weighting: input.weighting,
  buildingId: input.key === "per_building" ? input.buildingId : null,
});

/** New charge category of a residence, last in order; audited (it drives the splits). */
export async function createChargeCategory(ctx: TenantCtx, input: CategoryInput) {
  assertCan(ctx, "charge:create");
  return withTenant(ctx, async (tx) => {
    const target = await loadResidence(tx, input.residenceId, { forUpdate: true });
    await checkKeyTargets(tx, target, input);
    const [last] = await tx
      .select({ position: sql<number>`coalesce(max(${chargeCategory.position}), 0)::int` })
      .from(chargeCategory)
      .where(eq(chargeCategory.residenceId, target.id));
    const fields = fieldsOf(input);
    const [row] = await tx
      .insert(chargeCategory)
      .values({
        ...fields,
        organizationId: ctx.orgId,
        residenceId: target.id,
        position: (last?.position ?? 0) + 1,
        createdBy: ctx.userId,
      })
      .returning({ id: chargeCategory.id });
    if (!row) throw new Error("createChargeCategory: no row returned");
    await writeCustomUnits(tx, ctx, target.id, row.id, input);
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_category.create",
      entityType: "charge_category",
      entityId: row.id,
      after: { ...fields, unitIds: input.key === "custom" ? input.unitIds : [] },
    });
    return { id: row.id };
  });
}

/** A live category of the organization (locked); NOT_FOUND otherwise. */
async function loadCategory(tx: Tx, categoryId: string) {
  const [row] = await tx
    .select()
    .from(chargeCategory)
    .where(and(eq(chargeCategory.id, categoryId), isNull(chargeCategory.deletedAt)))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** Edits a category; issued calls keep the lines they were issued with. Audited. */
export async function updateChargeCategory(
  ctx: TenantCtx,
  input: In<typeof updateChargeCategorySchema>,
) {
  assertCan(ctx, "charge:create");
  await withTenant(ctx, async (tx) => {
    const current = await loadCategory(tx, input.categoryId);
    const target = await loadResidence(tx, current.residenceId, { forUpdate: true });
    await checkKeyTargets(tx, target, input);
    const fields = fieldsOf(input);
    await tx.update(chargeCategory).set(fields).where(eq(chargeCategory.id, current.id));
    await writeCustomUnits(tx, ctx, target.id, current.id, input);
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_category.update",
      entityType: "charge_category",
      entityId: current.id,
      before: {
        name: current.name,
        nameAr: current.nameAr,
        key: current.key,
        weighting: current.weighting,
        buildingId: current.buildingId,
      },
      after: { ...fields, unitIds: input.key === "custom" ? input.unitIds : [] },
    });
  });
}

/**
 * Removes a category (soft delete) and its amounts from draft budgets. Refused while an
 * approved budget calls it.
 */
export async function deleteChargeCategory(ctx: TenantCtx, categoryId: string) {
  assertCan(ctx, "charge:create");
  await withTenant(ctx, async (tx) => {
    const current = await loadCategory(tx, categoryId);
    const [approved] = await tx
      .select({ year: budget.year })
      .from(budgetLine)
      .innerJoin(budget, eq(budget.id, budgetLine.budgetId))
      .where(
        and(
          eq(budgetLine.categoryId, current.id),
          eq(budget.status, "approved"),
          sql`${budgetLine.amount} > 0`,
        ),
      )
      .limit(1);
    if (approved) throw new AppError("CONFLICT", "charges.errors.categoryInBudget");
    await tx
      .delete(budgetLine)
      .where(
        and(
          eq(budgetLine.categoryId, current.id),
          inArray(
            budgetLine.budgetId,
            tx.select({ id: budget.id }).from(budget).where(eq(budget.status, "draft")),
          ),
        ),
      );
    await tx
      .update(chargeCategory)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(chargeCategory.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "charge_category.delete",
      entityType: "charge_category",
      entityId: current.id,
      before: { name: current.name, key: current.key },
    });
  });
}
