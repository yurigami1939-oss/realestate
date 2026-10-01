import "server-only";

import { and, eq, isNull, lte } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { unit, unitOption } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleLead } from "@/server/crm/access";
import { recordLeadActivity } from "@/server/crm/activity";
import { transitionUnit } from "@/server/inventory/transition-unit";
import { loadSalesSettings } from "@/server/organizations/settings";

import type { cancelOptionSchema, placeOptionSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const unitCode = async (tx: Tx, unitId: string) =>
  (await tx.select({ code: unit.code }).from(unit).where(eq(unit.id, unitId)))[0]?.code ?? null;

/** Locks a live unit and checks it is available (friendlier than the status-machine error). */
export async function lockAvailableUnit(tx: Tx, unitId: string) {
  const [row] = await tx
    .select({ code: unit.code, status: unit.status, projectId: unit.projectId })
    .from(unit)
    .where(and(eq(unit.id, unitId), isNull(unit.deletedAt)))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  if (row.status !== "available") {
    throw new AppError("CONFLICT", "sales.errors.unitNotAvailable", {
      details: { unit: row.code, status: row.status },
    });
  }
  return row;
}

/**
 * Holds an available unit for a lead for the company's option duration (default 24 h,
 * CLAUDE.md §12). The expiry job is enqueued in the same transaction.
 */
export async function placeOption(ctx: TenantCtx, input: In<typeof placeOptionSchema>) {
  assertCan(ctx, "sale:create");
  return withTenant(ctx, async (tx) => {
    const lead = await loadVisibleLead(tx, ctx, input.leadId, { forUpdate: true });
    const target = await lockAvailableUnit(tx, input.unitId);
    const settings = await loadSalesSettings(tx, ctx.orgId);
    const placedAt = new Date();
    const expiresAt = new Date(placedAt.getTime() + settings.optionHours * 3_600_000);

    const [row] = await tx
      .insert(unitOption)
      .values({
        organizationId: ctx.orgId,
        unitId: input.unitId,
        leadId: lead.id,
        placedBy: ctx.userId,
        placedAt,
        expiresAt,
      })
      .returning({ id: unitOption.id });
    if (!row) throw new Error("placeOption: no row returned");
    // Locks the unit and refuses anything but available → optioned.
    await transitionUnit(tx, ctx, input.unitId, "optioned", {
      refType: "unit_option",
      refId: row.id,
    });
    await recordLeadActivity(tx, ctx, lead.id, "option_placed", {
      optionId: row.id,
      unitCode: target.code,
      expiresAt: expiresAt.toISOString(),
    });
    await enqueueInTx(
      tx,
      "option.expire",
      { organizationId: ctx.orgId, optionId: row.id },
      { startAfter: expiresAt, singletonKey: row.id },
    );
    return { id: row.id, expiresAt };
  });
}

/** Ends an active option early: anyone who sees the lead (its commercial, managers). */
export async function cancelOption(ctx: TenantCtx, input: In<typeof cancelOptionSchema>) {
  assertCan(ctx, "sale:create");
  await withTenant(ctx, async (tx) => {
    const [option] = await tx
      .select()
      .from(unitOption)
      .where(eq(unitOption.id, input.optionId))
      .for("update");
    if (!option) throw new AppError("NOT_FOUND");
    await loadVisibleLead(tx, ctx, option.leadId);
    if (option.status !== "active") throw new AppError("CONFLICT", "sales.errors.optionNotActive");
    await tx
      .update(unitOption)
      .set({
        status: "cancelled",
        endedAt: new Date(),
        endedBy: ctx.userId,
        endReason: input.reason,
      })
      .where(eq(unitOption.id, option.id));
    await transitionUnit(tx, ctx, option.unitId, "available", {
      reason: input.reason,
      refType: "unit_option",
      refId: option.id,
    });
    await recordLeadActivity(tx, ctx, option.leadId, "option_ended", {
      optionId: option.id,
      unitCode: await unitCode(tx, option.unitId),
      reason: "cancelled",
      note: input.reason,
    });
  });
}

/**
 * Job `option.expire`: releases the unit of an option that is still active and past its
 * expiry. Idempotent (an option already ended, or not yet expired, is left alone).
 */
export async function expireOption(payload: {
  organizationId: string;
  optionId: string;
}): Promise<"expired" | "skipped"> {
  const actor = { orgId: payload.organizationId, userId: null };
  return withTenant(actor, async (tx) => {
    const [option] = await tx
      .select()
      .from(unitOption)
      .where(
        and(
          eq(unitOption.id, payload.optionId),
          eq(unitOption.status, "active"),
          lte(unitOption.expiresAt, new Date()),
        ),
      )
      .for("update");
    if (!option) return "skipped";
    await tx
      .update(unitOption)
      .set({ status: "expired", endedAt: new Date() })
      .where(eq(unitOption.id, option.id));
    await transitionUnit(tx, actor, option.unitId, "available", {
      reason: "option_expired",
      refType: "unit_option",
      refId: option.id,
    });
    await recordLeadActivity(tx, actor, option.leadId, "option_ended", {
      optionId: option.id,
      unitCode: await unitCode(tx, option.unitId),
      reason: "expired",
    });
    return "expired";
  });
}
