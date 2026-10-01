import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { constructionMilestone, paymentPlan, paymentPlanStep } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import type { PlanMilestone, PlanStep } from "@/lib/payment-plans";
import type { ConstructionStage } from "@/lib/sales";
import { assertCan, type TenantCtx } from "@/server/auth/session";

/** Planned construction milestones of a project, in order. */
export async function loadMilestones(tx: Tx, projectId: string) {
  return tx
    .select({
      id: constructionMilestone.id,
      name: constructionMilestone.name,
      stage: constructionMilestone.stage,
      plannedOn: constructionMilestone.plannedOn,
      validatedOn: constructionMilestone.validatedOn,
    })
    .from(constructionMilestone)
    .where(
      and(eq(constructionMilestone.projectId, projectId), isNull(constructionMilestone.deletedAt)),
    )
    .orderBy(asc(constructionMilestone.position));
}

export type PaymentPlanWithSteps = {
  id: string;
  name: string;
  isDefault: boolean;
  notes: string | null;
  steps: PlanStep[];
};

/** Live plans of a project (default first) with their ordered steps. */
export async function loadPaymentPlans(
  tx: Tx,
  projectId: string,
  planIds?: string[],
): Promise<PaymentPlanWithSteps[]> {
  const plans = await tx
    .select({
      id: paymentPlan.id,
      name: paymentPlan.name,
      isDefault: paymentPlan.isDefault,
      notes: paymentPlan.notes,
    })
    .from(paymentPlan)
    .where(
      and(
        eq(paymentPlan.projectId, projectId),
        isNull(paymentPlan.deletedAt),
        planIds ? inArray(paymentPlan.id, planIds) : undefined,
      ),
    )
    .orderBy(desc(paymentPlan.isDefault), asc(paymentPlan.name));
  if (plans.length === 0) return [];
  const steps = await tx
    .select({
      planId: paymentPlanStep.planId,
      label: paymentPlanStep.label,
      shareBp: paymentPlanStep.shareBp,
      trigger: paymentPlanStep.trigger,
      months: paymentPlanStep.months,
      milestoneId: paymentPlanStep.milestoneId,
    })
    .from(paymentPlanStep)
    .where(
      inArray(
        paymentPlanStep.planId,
        plans.map((p) => p.id),
      ),
    )
    .orderBy(asc(paymentPlanStep.position));
  return plans.map((p) => ({
    ...p,
    steps: steps.filter((s) => s.planId === p.id).map(({ planId: _planId, ...step }) => step),
  }));
}

/** Milestones and plans of a project, for the project pages and the simulator. */
export async function getProjectPaymentSetup(ctx: TenantCtx, projectId: string) {
  assertCan(ctx, "inventory:read");
  if (!isUuid(projectId)) return { milestones: [], plans: [] };
  return withTenant(ctx, async (tx) => {
    const milestones = await loadMilestones(tx, projectId);
    const plans = await loadPaymentPlans(tx, projectId);
    return { milestones, plans };
  });
}

export type ProjectPaymentSetup = Awaited<ReturnType<typeof getProjectPaymentSetup>>;
export type MilestoneRow = ProjectPaymentSetup["milestones"][number] & PlanMilestone;

/** Plans and milestones of every live project (simulator), keyed by project id. */
export async function listPaymentSetups(ctx: TenantCtx) {
  assertCan(ctx, "inventory:read");
  return withTenant(ctx, async (tx) => {
    const milestones = await tx
      .select({
        id: constructionMilestone.id,
        projectId: constructionMilestone.projectId,
        name: constructionMilestone.name,
        stage: constructionMilestone.stage,
        plannedOn: constructionMilestone.plannedOn,
        validatedOn: constructionMilestone.validatedOn,
      })
      .from(constructionMilestone)
      .where(isNull(constructionMilestone.deletedAt))
      .orderBy(asc(constructionMilestone.position));
    const plans = await tx
      .select({ id: paymentPlan.id, projectId: paymentPlan.projectId })
      .from(paymentPlan)
      .where(isNull(paymentPlan.deletedAt));
    const byProject: Record<
      string,
      {
        milestones: {
          id: string;
          name: string;
          stage: ConstructionStage | null;
          plannedOn: string | null;
          validatedOn: string | null;
        }[];
        plans: PaymentPlanWithSteps[];
      }
    > = {};
    for (const projectId of new Set(plans.map((p) => p.projectId))) {
      byProject[projectId] = {
        milestones: milestones
          .filter((m) => m.projectId === projectId)
          .map(({ projectId: _p, ...m }) => m),
        plans: await loadPaymentPlans(tx, projectId),
      };
    }
    return byProject;
  });
}

export type PaymentSetups = Awaited<ReturnType<typeof listPaymentSetups>>;
