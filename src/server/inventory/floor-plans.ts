import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";

import type { unitIdSchema } from "./schemas";

async function lockUnit(tx: Tx, unitId: string) {
  const [row] = await tx
    .select({ floorPlanFileId: unit.floorPlanFileId })
    .from(unit)
    .where(and(eq(unit.id, unitId), isNull(unit.deletedAt)))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** Stores a floor plan (PDF or image) and links it to the unit; the previous plan is discarded. */
export async function setUnitFloorPlan(
  ctx: TenantCtx,
  input: { unitId: string; upload: Upload },
): Promise<{ fileId: string }> {
  assertCan(ctx, "unit:update");
  const contentType = checkUpload("unit.floor_plan", input.upload);
  return withTenant(ctx, async (tx) => {
    const current = await lockUnit(tx, input.unitId);
    const stored = await storeFile(tx, ctx, {
      entityType: "unit",
      entityId: input.unitId,
      upload: input.upload,
      contentType,
    });
    await tx.update(unit).set({ floorPlanFileId: stored.id }).where(eq(unit.id, input.unitId));
    if (current.floorPlanFileId) await discardFile(tx, current.floorPlanFileId);
    return { fileId: stored.id };
  });
}

export async function removeUnitFloorPlan(ctx: TenantCtx, input: z.output<typeof unitIdSchema>) {
  assertCan(ctx, "unit:update");
  await withTenant(ctx, async (tx) => {
    const current = await lockUnit(tx, input.unitId);
    if (!current.floorPlanFileId) return;
    await tx.update(unit).set({ floorPlanFileId: null }).where(eq(unit.id, input.unitId));
    await discardFile(tx, current.floorPlanFileId);
  });
}
