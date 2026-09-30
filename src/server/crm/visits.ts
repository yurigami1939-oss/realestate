import "server-only";

import { eq } from "drizzle-orm";
import type { z } from "zod";

import { visit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import {
  assertLeadOwner,
  assertLiveProject,
  assertLiveUnit,
  loadVisibleLead,
  seesAllLeads,
} from "./access";
import { recordLeadActivity } from "./activity";
import { advanceLeadStage } from "./leads";
import type { scheduleVisitSchema, updateVisitSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Plans a visit; the lead moves to "visite planifiée" if it was earlier in the pipeline. */
export async function scheduleVisit(ctx: TenantCtx, input: In<typeof scheduleVisitSchema>) {
  assertCan(ctx, "lead:update");
  return withTenant(ctx, async (tx) => {
    const current = await loadVisibleLead(tx, ctx, input.leadId, { forUpdate: true });
    let projectId = input.projectId;
    if (projectId) await assertLiveProject(tx, projectId);
    if (input.unitId) projectId = (await assertLiveUnit(tx, input.unitId, projectId)).projectId;

    // Managers pick the host; a commercial hosts their own visits.
    const agentUserId = seesAllLeads(ctx)
      ? (input.agentUserId ?? current.assignedTo ?? ctx.userId)
      : ctx.userId;
    if (agentUserId !== ctx.userId)
      await assertLeadOwner(tx, ctx.orgId, agentUserId, "agentUserId");

    const [row] = await tx
      .insert(visit)
      .values({
        organizationId: ctx.orgId,
        leadId: input.leadId,
        projectId,
        unitId: input.unitId,
        scheduledAt: input.scheduledAt,
        agentUserId,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: visit.id });
    if (!row) throw new Error("scheduleVisit: no row returned");
    await recordLeadActivity(tx, ctx, input.leadId, "visit_scheduled", {
      visitId: row.id,
      scheduledAt: input.scheduledAt.toISOString(),
    });
    await advanceLeadStage(tx, ctx, current, "visit_scheduled");
    return { id: row.id };
  });
}

/** Records the outcome (done, cancelled, no-show) or reschedules; done moves the lead to "visité". */
export async function updateVisit(ctx: TenantCtx, input: In<typeof updateVisitSchema>) {
  assertCan(ctx, "lead:update");
  await withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select({ leadId: visit.leadId })
      .from(visit)
      .where(eq(visit.id, input.visitId));
    if (!existing) throw new AppError("NOT_FOUND");
    const current = await loadVisibleLead(tx, ctx, existing.leadId, { forUpdate: true });

    await tx
      .update(visit)
      .set({
        status: input.status,
        scheduledAt: input.scheduledAt,
        outcome: input.outcome,
        completedAt: input.status === "done" ? new Date() : null,
      })
      .where(eq(visit.id, input.visitId));
    await recordLeadActivity(tx, ctx, current.id, "visit_updated", {
      visitId: input.visitId,
      status: input.status,
      outcome: input.outcome,
    });
    if (input.status === "done") await advanceLeadStage(tx, ctx, current, "visited");
  });
}
