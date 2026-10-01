import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { budget, budgetLine, chargeCategory } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { sumCentimes } from "@/lib/money";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";

import type { saveBudgetSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** A budget of the organization, locked; NOT_FOUND otherwise. */
export async function loadBudget(tx: Tx, budgetId: string) {
  const [row] = await tx.select().from(budget).where(eq(budget.id, budgetId)).for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** Lines of a budget with their category, in category order. */
export async function budgetLines(tx: Tx, budgetId: string) {
  return tx
    .select({
      categoryId: budgetLine.categoryId,
      amount: budgetLine.amount,
      name: chargeCategory.name,
      nameAr: chargeCategory.nameAr,
    })
    .from(budgetLine)
    .innerJoin(chargeCategory, eq(chargeCategory.id, budgetLine.categoryId))
    .where(eq(budgetLine.budgetId, budgetId))
    .orderBy(asc(chargeCategory.position), asc(chargeCategory.name));
}

/**
 * Creates or updates the draft budget of a year: the annual amount of each category (empty or
 * 0 = nothing budgeted). Approved budgets are read-only.
 */
export async function saveBudget(ctx: TenantCtx, input: In<typeof saveBudgetSchema>) {
  assertCan(ctx, "charge:create");
  return withTenant(ctx, async (tx) => {
    const target = await loadResidence(tx, input.residenceId, { forUpdate: true });
    const categories = await tx
      .select({ id: chargeCategory.id })
      .from(chargeCategory)
      .where(and(eq(chargeCategory.residenceId, target.id), isNull(chargeCategory.deletedAt)));
    const known = new Set(categories.map((c) => c.id));
    if (input.lines.some((l) => !known.has(l.categoryId))) {
      throw invalid("lines", "charges.errors.categoryNotFound");
    }

    const [current] = await tx
      .select({ id: budget.id, status: budget.status })
      .from(budget)
      .where(and(eq(budget.residenceId, target.id), eq(budget.year, input.year)))
      .for("update");
    if (current?.status === "approved") {
      throw new AppError("CONFLICT", "charges.errors.budgetApproved");
    }
    let budgetId = current?.id;
    if (budgetId) {
      await tx.update(budget).set({ notes: input.notes }).where(eq(budget.id, budgetId));
      await tx.delete(budgetLine).where(eq(budgetLine.budgetId, budgetId));
    } else {
      const [row] = await tx
        .insert(budget)
        .values({
          organizationId: ctx.orgId,
          residenceId: target.id,
          year: input.year,
          notes: input.notes,
          createdBy: ctx.userId,
        })
        .returning({ id: budget.id });
      if (!row) throw new Error("saveBudget: no row returned");
      budgetId = row.id;
    }
    const lines = input.lines.flatMap((l) =>
      l.amount !== null && l.amount > 0n ? [{ categoryId: l.categoryId, amount: l.amount }] : [],
    );
    if (lines.length > 0) {
      await tx.insert(budgetLine).values(
        lines.map((l) => ({
          organizationId: ctx.orgId,
          residenceId: target.id,
          budgetId: budgetId,
          categoryId: l.categoryId,
          amount: l.amount,
        })),
      );
    }
    return { budgetId, total: sumCentimes(lines.map((l) => l.amount)) };
  });
}

/**
 * Approves a draft budget: it becomes read-only and freezes the residence's call frequency and
 * reserve fund rate; calls can then be issued from it. Audited.
 */
export async function approveBudget(ctx: TenantCtx, budgetId: string) {
  assertCan(ctx, "charge:create");
  await withTenant(ctx, async (tx) => {
    const current = await loadBudget(tx, budgetId);
    if (current.status !== "draft") {
      throw new AppError("CONFLICT", "charges.errors.budgetApproved");
    }
    const target = await loadResidence(tx, current.residenceId, { forUpdate: true });
    const lines = await budgetLines(tx, current.id);
    const total = sumCentimes(lines.map((l) => l.amount));
    if (total === 0n) throw new AppError("CONFLICT", "charges.errors.emptyBudget");
    await tx
      .update(budget)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedBy: ctx.userId,
        frequency: target.chargeFrequency,
        reserveFundBp: target.reserveFundBp,
      })
      .where(eq(budget.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "budget.approve",
      entityType: "budget",
      entityId: current.id,
      after: {
        residence: target.name,
        year: current.year,
        total,
        frequency: target.chargeFrequency,
        reserveFundBp: target.reserveFundBp,
        lines: lines.map((l) => ({ category: l.name, amount: l.amount })),
      },
    });
  });
}
