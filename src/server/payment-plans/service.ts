import "server-only";

import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { constructionMilestone, paymentPlan, paymentPlanStep, project } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type {
  createPaymentPlanSchema,
  paymentPlanFields,
  paymentPlanIdSchema,
  saveMilestonesSchema,
  updatePaymentPlanSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

async function assertLiveProject(tx: Tx, projectId: string) {
  const [row] = await tx
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), isNull(project.deletedAt)))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
}

const liveMilestones = (tx: Tx, projectId: string) =>
  tx
    .select({ id: constructionMilestone.id })
    .from(constructionMilestone)
    .where(
      and(eq(constructionMilestone.projectId, projectId), isNull(constructionMilestone.deletedAt)),
    );

/**
 * Replaces the planned construction milestones of a project with the given ordered list:
 * existing ones are updated, new ones created, missing ones removed (unless a plan uses them).
 */
export async function saveMilestones(ctx: TenantCtx, input: In<typeof saveMilestonesSchema>) {
  assertCan(ctx, "project:update");
  await withTenant(ctx, async (tx) => {
    await assertLiveProject(tx, input.projectId);
    const existing = new Set((await liveMilestones(tx, input.projectId)).map((m) => m.id));
    const kept = new Set(input.milestones.map((m) => m.id).filter((id) => id !== ""));
    if ([...kept].some((id) => !existing.has(id))) throw new AppError("NOT_FOUND");

    const removed = [...existing].filter((id) => !kept.has(id));
    if (removed.length > 0) {
      const [used] = await tx
        .select({ id: paymentPlanStep.milestoneId })
        .from(paymentPlanStep)
        .innerJoin(paymentPlan, eq(paymentPlan.id, paymentPlanStep.planId))
        .where(and(inArray(paymentPlanStep.milestoneId, removed), isNull(paymentPlan.deletedAt)))
        .limit(1);
      if (used) throw new AppError("CONFLICT", "paymentPlans.errors.milestoneInUse");
      await tx
        .update(constructionMilestone)
        .set({ deletedAt: new Date(), deletedBy: ctx.userId })
        .where(inArray(constructionMilestone.id, removed));
    }

    for (const [index, m] of input.milestones.entries()) {
      const values = { name: m.name, plannedOn: m.plannedOn, position: index + 1 };
      if (m.id) {
        await tx
          .update(constructionMilestone)
          .set(values)
          .where(eq(constructionMilestone.id, m.id));
      } else {
        await tx.insert(constructionMilestone).values({
          ...values,
          organizationId: ctx.orgId,
          projectId: input.projectId,
          createdBy: ctx.userId,
        });
      }
    }
  });
}

type PlanInput = In<typeof paymentPlanFields>;

/** Every milestone used by the steps must be a live milestone of the plan's project. */
async function assertStepMilestones(tx: Tx, projectId: string, steps: PlanInput["steps"]) {
  const allowed = new Set((await liveMilestones(tx, projectId)).map((m) => m.id));
  steps.forEach((step, index) => {
    if (step.milestoneId !== null && !allowed.has(step.milestoneId)) {
      throw new AppError("VALIDATION", "paymentPlans.errors.milestoneNotFound", {
        fieldErrors: { [`steps.${index}.milestoneId`]: ["paymentPlans.errors.milestoneNotFound"] },
      });
    }
  });
}

async function writeSteps(
  tx: Tx,
  ctx: TenantCtx,
  plan: { id: string; projectId: string },
  steps: PlanInput["steps"],
) {
  await tx.delete(paymentPlanStep).where(eq(paymentPlanStep.planId, plan.id));
  await tx.insert(paymentPlanStep).values(
    steps.map((step, index) => ({
      ...step,
      organizationId: ctx.orgId,
      planId: plan.id,
      projectId: plan.projectId,
      position: index + 1,
    })),
  );
}

/** Makes `planId` the project's only default plan. */
async function setDefault(tx: Tx, projectId: string, planId: string) {
  await tx
    .update(paymentPlan)
    .set({ isDefault: false })
    .where(
      and(
        eq(paymentPlan.projectId, projectId),
        ne(paymentPlan.id, planId),
        eq(paymentPlan.isDefault, true),
      ),
    );
  await tx.update(paymentPlan).set({ isDefault: true }).where(eq(paymentPlan.id, planId));
}

/** New plan; the first plan of a project becomes its default. */
export async function createPaymentPlan(ctx: TenantCtx, input: In<typeof createPaymentPlanSchema>) {
  assertCan(ctx, "project:update");
  return withTenant(ctx, async (tx) => {
    await assertLiveProject(tx, input.projectId);
    await assertStepMilestones(tx, input.projectId, input.steps);
    const [other] = await tx
      .select({ id: paymentPlan.id })
      .from(paymentPlan)
      .where(and(eq(paymentPlan.projectId, input.projectId), isNull(paymentPlan.deletedAt)))
      .limit(1);

    const [row] = await tx
      .insert(paymentPlan)
      .values({
        organizationId: ctx.orgId,
        projectId: input.projectId,
        name: input.name,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: paymentPlan.id });
    if (!row) throw new Error("createPaymentPlan: no row returned");
    await writeSteps(tx, ctx, { id: row.id, projectId: input.projectId }, input.steps);
    if (input.isDefault || !other) await setDefault(tx, input.projectId, row.id);
    return { id: row.id };
  });
}

/** Replaces a plan's name, notes and steps. Issued quotations keep their own copy. */
export async function updatePaymentPlan(ctx: TenantCtx, input: In<typeof updatePaymentPlanSchema>) {
  assertCan(ctx, "project:update");
  await withTenant(ctx, async (tx) => {
    const [plan] = await tx
      .select({ projectId: paymentPlan.projectId, isDefault: paymentPlan.isDefault })
      .from(paymentPlan)
      .where(and(eq(paymentPlan.id, input.planId), isNull(paymentPlan.deletedAt)))
      .for("update");
    if (!plan) throw new AppError("NOT_FOUND");
    await assertStepMilestones(tx, plan.projectId, input.steps);
    await tx
      .update(paymentPlan)
      .set({ name: input.name, notes: input.notes })
      .where(eq(paymentPlan.id, input.planId));
    await writeSteps(tx, ctx, { id: input.planId, projectId: plan.projectId }, input.steps);
    if (input.isDefault && !plan.isDefault) await setDefault(tx, plan.projectId, input.planId);
  });
}

export async function deletePaymentPlan(ctx: TenantCtx, input: In<typeof paymentPlanIdSchema>) {
  assertCan(ctx, "project:update");
  await withTenant(ctx, async (tx) => {
    const [plan] = await tx
      .select({ projectId: paymentPlan.projectId, isDefault: paymentPlan.isDefault })
      .from(paymentPlan)
      .where(and(eq(paymentPlan.id, input.planId), isNull(paymentPlan.deletedAt)))
      .for("update");
    if (!plan) throw new AppError("NOT_FOUND");
    await tx
      .update(paymentPlan)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId, isDefault: false })
      .where(eq(paymentPlan.id, input.planId));
    if (plan.isDefault) {
      // Hand the default over to the oldest remaining plan, if any.
      const [next] = await tx
        .select({ id: paymentPlan.id })
        .from(paymentPlan)
        .where(and(eq(paymentPlan.projectId, plan.projectId), isNull(paymentPlan.deletedAt)))
        .orderBy(asc(paymentPlan.createdAt))
        .limit(1);
      if (next) await setDefault(tx, plan.projectId, next.id);
    }
  });
}
