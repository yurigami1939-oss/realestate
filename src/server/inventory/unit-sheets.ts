import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { unit, unitSheet, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { buildSchedule } from "@/lib/payment-plans";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadMilestones, loadPaymentPlans } from "@/server/payment-plans/queries";

/**
 * Fiche du lot for a prospect (`inventory:read`, CLAUDE.md §7 Inventory): the unit with its
 * asking price and the project's default payment plan as today. The same day's sheet is
 * reused while the price and the status are unchanged; else a new one is rendered.
 */
export async function issueUnitSheet(ctx: TenantCtx, input: { unitId: string }) {
  assertCan(ctx, "inventory:read");
  if (!isUuid(input.unitId)) throw new AppError("NOT_FOUND");
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const [target] = await tx
      .select({
        id: unit.id,
        projectId: unit.projectId,
        status: unit.status,
        listPrice: unit.listPrice,
      })
      .from(unit)
      .where(and(eq(unit.id, input.unitId), isNull(unit.deletedAt)));
    if (!target) throw new AppError("NOT_FOUND");
    const [latest] = await tx
      .select({
        id: unitSheet.id,
        status: unitSheet.status,
        listPrice: unitSheet.listPrice,
      })
      .from(unitSheet)
      .where(and(eq(unitSheet.unitId, target.id), eq(unitSheet.issuedOn, today)))
      .orderBy(desc(unitSheet.createdAt))
      .limit(1);
    if (latest && latest.status === target.status && latest.listPrice === target.listPrice) {
      return { id: latest.id, reused: true };
    }

    const [plan] = await loadPaymentPlans(tx, target.projectId);
    const milestones = await loadMilestones(tx, target.projectId);
    const lines =
      plan && target.listPrice !== null
        ? buildSchedule(target.listPrice, plan.steps, today, milestones).map((line, index) => ({
            label: line.label,
            shareBp: line.shareBp,
            amount: line.amount.toString(),
            trigger: line.trigger,
            months: plan.steps[index]?.months ?? null,
            milestoneName: line.milestoneName,
          }))
        : [];
    const [row] = await tx
      .insert(unitSheet)
      .values({
        organizationId: ctx.orgId,
        unitId: target.id,
        issuedOn: today,
        status: target.status,
        listPrice: target.listPrice,
        planName: plan?.name ?? null,
        lines,
        createdBy: ctx.userId,
      })
      .returning({ id: unitSheet.id });
    if (!row) throw new Error("issueUnitSheet: no row returned");
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "unit_sheet", id: row.id },
      { singletonKey: row.id },
    );
    return { id: row.id, reused: false };
  });
}

/** The unit's latest sheets (unit page). */
export async function listUnitSheets(ctx: TenantCtx, unitId: string) {
  assertCan(ctx, "inventory:read");
  if (!isUuid(unitId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: unitSheet.id,
        issuedOn: unitSheet.issuedOn,
        listPrice: unitSheet.listPrice,
        createdByName: user.name,
        pdfFileId: unitSheet.pdfFileId,
      })
      .from(unitSheet)
      .innerJoin(user, eq(user.id, unitSheet.createdBy))
      .where(eq(unitSheet.unitId, unitId))
      .orderBy(desc(unitSheet.createdAt))
      .limit(5),
  );
}
