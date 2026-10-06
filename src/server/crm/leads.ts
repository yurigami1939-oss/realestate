import "server-only";

import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { followUp, lead, visit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { advanceStage } from "@/lib/crm";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { assertLeadOwner, assertLiveProject, loadVisibleLead, seesAllLeads } from "./access";
import { recordLeadActivity } from "./activity";
import type {
  addLeadNoteSchema,
  assignLeadSchema,
  changeLeadStageSchema,
  createLeadSchema,
  leadIdSchema,
  mergeLeadsSchema,
  updateLeadSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Other live leads sharing one of these phones (possible duplicates, CLAUDE.md §12). */
export async function countDuplicates(tx: Tx, phones: (string | null)[], exceptId?: string) {
  const values = phones.filter((p): p is string => p !== null);
  if (values.length === 0) return 0;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(lead)
    .where(
      and(
        isNull(lead.deletedAt),
        exceptId ? ne(lead.id, exceptId) : undefined,
        or(inArray(lead.phone, values), inArray(lead.phone2, values)),
      ),
    );
  return row?.n ?? 0;
}

export async function createLead(
  ctx: TenantCtx,
  input: In<typeof createLeadSchema>,
  /** An open tenant transaction to join (a data import's). */
  outer?: Tx,
) {
  assertCan(ctx, "lead:create");
  return withTenant(
    ctx,
    async (tx) => {
      const { assignedTo: requested, ...fields } = input;
      // A commercial's lead is always theirs; a manager may assign it or leave it unassigned.
      const assignedTo = seesAllLeads(ctx) ? requested : ctx.userId;
      if (assignedTo) await assertLeadOwner(tx, ctx.orgId, assignedTo, "assignedTo");
      if (fields.projectId) await assertLiveProject(tx, fields.projectId);

      const [row] = await tx
        .insert(lead)
        .values({ ...fields, organizationId: ctx.orgId, assignedTo, createdBy: ctx.userId })
        .returning({ id: lead.id });
      if (!row) throw new Error("createLead: no row returned");
      await recordLeadActivity(tx, ctx, row.id, "created", { source: fields.source });
      const duplicates = await countDuplicates(tx, [fields.phone, fields.phone2], row.id);
      return { id: row.id, duplicates };
    },
    outer,
  );
}

export async function updateLead(ctx: TenantCtx, input: In<typeof updateLeadSchema>) {
  assertCan(ctx, "lead:update");
  return withTenant(ctx, async (tx) => {
    const { leadId, ...fields } = input;
    await loadVisibleLead(tx, ctx, leadId, { forUpdate: true });
    if (fields.projectId) await assertLiveProject(tx, fields.projectId);
    await tx.update(lead).set(fields).where(eq(lead.id, leadId));
    await recordLeadActivity(tx, ctx, leadId, "updated");
    return { duplicates: await countDuplicates(tx, [fields.phone, fields.phone2], leadId) };
  });
}

export async function changeLeadStage(ctx: TenantCtx, input: In<typeof changeLeadStageSchema>) {
  assertCan(ctx, "lead:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadVisibleLead(tx, ctx, input.leadId, { forUpdate: true });
    const lost = input.stage === "lost";
    if (current.stage === input.stage && !lost) return;
    await tx
      .update(lead)
      .set({
        stage: input.stage,
        lostReason: lost ? input.lostReason : null,
        lostNote: lost ? input.lostNote : null,
      })
      .where(eq(lead.id, input.leadId));
    await recordLeadActivity(tx, ctx, input.leadId, "stage_changed", {
      from: current.stage,
      to: input.stage,
      lostReason: lost ? input.lostReason : null,
      note: lost ? input.lostNote : null,
    });
  });
}

/**
 * Moves the lead forward after an event (visit planned or done, quotation issued).
 * Never backwards, never out of won/lost. Caller holds the lead's row lock.
 */
export async function advanceLeadStage(
  tx: Tx,
  actor: Pick<TenantCtx, "orgId" | "userId">,
  current: { id: string; stage: typeof lead.$inferSelect.stage },
  reached: typeof lead.$inferSelect.stage,
) {
  const next = advanceStage(current.stage, reached);
  if (next === current.stage) return;
  await tx.update(lead).set({ stage: next }).where(eq(lead.id, current.id));
  await recordLeadActivity(tx, actor, current.id, "stage_changed", {
    from: current.stage,
    to: next,
    lostReason: null,
    note: null,
  });
}

/** Managers (re)assign a lead; the previous owner's open follow-ups move with it. */
export async function assignLead(ctx: TenantCtx, input: In<typeof assignLeadSchema>) {
  assertCan(ctx, "lead:assign");
  await withTenant(ctx, async (tx) => {
    const current = await loadVisibleLead(tx, ctx, input.leadId, { forUpdate: true });
    if (current.assignedTo === input.assignedTo) return;
    if (input.assignedTo) await assertLeadOwner(tx, ctx.orgId, input.assignedTo, "assignedTo");

    await tx.update(lead).set({ assignedTo: input.assignedTo }).where(eq(lead.id, input.leadId));
    if (current.assignedTo && input.assignedTo) {
      await tx
        .update(followUp)
        .set({ assignedTo: input.assignedTo })
        .where(
          and(
            eq(followUp.leadId, input.leadId),
            eq(followUp.assignedTo, current.assignedTo),
            isNull(followUp.doneAt),
          ),
        );
    }
    await recordLeadActivity(tx, ctx, input.leadId, "assigned", {
      from: current.assignedTo,
      to: input.assignedTo,
    });
  });
}

export async function addLeadNote(ctx: TenantCtx, input: In<typeof addLeadNoteSchema>) {
  assertCan(ctx, "lead:update");
  await withTenant(ctx, async (tx) => {
    await loadVisibleLead(tx, ctx, input.leadId);
    await recordLeadActivity(tx, ctx, input.leadId, "note", { text: input.note });
  });
}

const firstNonNull = <T>(a: T | null, b: T | null) => (a !== null ? a : b);

/**
 * Merges a duplicate (`source`) into `target`: visits and follow-ups move over, empty fields
 * are filled from the source, the source is soft-deleted and points to the target.
 * The target's timeline also shows the source's history (queries follow `mergedIntoId`).
 */
export async function mergeLeads(ctx: TenantCtx, input: In<typeof mergeLeadsSchema>) {
  assertCan(ctx, "lead:merge");
  await withTenant(ctx, async (tx) => {
    // Lock in id order so two concurrent merges of the same pair cannot deadlock.
    const [firstId, secondId] = [input.targetId, input.sourceId].sort();
    const first = await loadVisibleLead(tx, ctx, firstId ?? "", { forUpdate: true });
    const second = await loadVisibleLead(tx, ctx, secondId ?? "", { forUpdate: true });
    const target = first.id === input.targetId ? first : second;
    const source = first.id === input.targetId ? second : first;

    const phones = [target.phone, target.phone2];
    const phone2 =
      target.phone2 ??
      [source.phone, source.phone2].find((p) => p !== null && !phones.includes(p)) ??
      null;
    const notes =
      [target.notes, source.notes].filter((n): n is string => n !== null).join("\n\n") || null;

    await tx
      .update(lead)
      .set({
        phone2,
        email: firstNonNull(target.email, source.email),
        city: firstNonNull(target.city, source.city),
        sourceDetail: firstNonNull(target.sourceDetail, source.sourceDetail),
        projectId: firstNonNull(target.projectId, source.projectId),
        typologies: target.typologies.length > 0 ? target.typologies : source.typologies,
        budget: firstNonNull(target.budget, source.budget),
        financing: firstNonNull(target.financing, source.financing),
        notes,
        assignedTo: firstNonNull(target.assignedTo, source.assignedTo),
        stage: advanceStage(target.stage, source.stage === "lost" ? "new" : source.stage),
      })
      .where(eq(lead.id, target.id));

    await tx.update(visit).set({ leadId: target.id }).where(eq(visit.leadId, source.id));
    await tx.update(followUp).set({ leadId: target.id }).where(eq(followUp.leadId, source.id));
    // Leads merged into the source earlier now point to the target.
    await tx.update(lead).set({ mergedIntoId: target.id }).where(eq(lead.mergedIntoId, source.id));
    await tx
      .update(lead)
      .set({ mergedIntoId: target.id, deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(lead.id, source.id));

    await recordLeadActivity(tx, ctx, target.id, "merged", {
      sourceId: source.id,
      sourceName: source.fullName,
    });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lead.merge",
      entityType: "lead",
      entityId: target.id,
      before: { source: { id: source.id, fullName: source.fullName, phone: source.phone } },
      after: null,
    });
  });
}

export async function deleteLead(ctx: TenantCtx, input: In<typeof leadIdSchema>) {
  assertCan(ctx, "lead:delete");
  await withTenant(ctx, async (tx) => {
    await loadVisibleLead(tx, ctx, input.leadId, { forUpdate: true });
    await tx
      .update(lead)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(lead.id, input.leadId));
  });
}
