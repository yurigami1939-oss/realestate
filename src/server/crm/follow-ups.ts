import "server-only";

import { eq } from "drizzle-orm";
import type { z } from "zod";

import { followUp } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { assertLeadOwner, loadVisibleLead, seesAllLeads } from "./access";
import { recordLeadActivity } from "./activity";
import { advanceLeadStage } from "./leads";
import type { completeFollowUpSchema, createFollowUpSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Plans a relance. A commercial plans their own; managers may assign it to anyone. */
export async function createFollowUp(ctx: TenantCtx, input: In<typeof createFollowUpSchema>) {
  assertCan(ctx, "lead:update");
  return withTenant(ctx, async (tx) => {
    const current = await loadVisibleLead(tx, ctx, input.leadId);
    const assignedTo = seesAllLeads(ctx)
      ? (input.assignedTo ?? current.assignedTo ?? ctx.userId)
      : ctx.userId;
    if (assignedTo !== ctx.userId) await assertLeadOwner(tx, ctx.orgId, assignedTo, "assignedTo");

    const [row] = await tx
      .insert(followUp)
      .values({
        organizationId: ctx.orgId,
        leadId: input.leadId,
        dueAt: input.dueAt,
        channel: input.channel,
        note: input.note,
        assignedTo,
        createdBy: ctx.userId,
      })
      .returning({ id: followUp.id });
    if (!row) throw new Error("createFollowUp: no row returned");
    await recordLeadActivity(tx, ctx, input.leadId, "follow_up_created", {
      followUpId: row.id,
      dueAt: input.dueAt.toISOString(),
      channel: input.channel,
    });
    return { id: row.id };
  });
}

/** Marks a relance done (idempotent); a new lead counts as contacted. */
export async function completeFollowUp(ctx: TenantCtx, input: In<typeof completeFollowUpSchema>) {
  assertCan(ctx, "lead:update");
  await withTenant(ctx, async (tx) => {
    // Lock order: lead first, then its follow-up (as assignLead does).
    const [ref] = await tx
      .select({ leadId: followUp.leadId })
      .from(followUp)
      .where(eq(followUp.id, input.followUpId));
    if (!ref) throw new AppError("NOT_FOUND");
    const current = await loadVisibleLead(tx, ctx, ref.leadId, { forUpdate: true });
    const [existing] = await tx
      .select({ doneAt: followUp.doneAt, channel: followUp.channel })
      .from(followUp)
      .where(eq(followUp.id, input.followUpId))
      .for("update");
    if (!existing || existing.doneAt) return;

    await tx
      .update(followUp)
      .set({ doneAt: new Date(), doneBy: ctx.userId, outcome: input.outcome })
      .where(eq(followUp.id, input.followUpId));
    await recordLeadActivity(tx, ctx, current.id, "follow_up_done", {
      followUpId: input.followUpId,
      channel: existing.channel,
      outcome: input.outcome,
    });
    await advanceLeadStage(tx, ctx, current, "contacted");
  });
}
