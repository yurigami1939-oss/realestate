import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { lease, managementMandate, propertyOwner, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type {
  createMandateSchema,
  createOwnerSchema,
  endMandateSchema,
  updateOwnerSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Entity type of an owner's documents (its statements) and of its audit rows. */
export const OWNER_ENTITY = "property_owner";

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

function assertNotFuture(day: string, field: string) {
  if (day > todayInAlgiers()) throw invalid(field, "rentals.errors.futureDate");
}

export async function loadOwner(tx: Tx, ownerId: string) {
  const [row] = await tx
    .select()
    .from(propertyOwner)
    .where(and(eq(propertyOwner.id, ownerId), isNull(propertyOwner.deletedAt)));
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** A new owner (mandant) whose units the organization lets (`lease:update`). Audited. */
export async function createOwner(ctx: TenantCtx, input: In<typeof createOwnerSchema>) {
  assertCan(ctx, "lease:update");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(propertyOwner)
      .values({ ...input, organizationId: ctx.orgId, createdBy: ctx.userId })
      .returning({ id: propertyOwner.id });
    if (!row) throw new Error("createOwner: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "property_owner.create",
      entityType: OWNER_ENTITY,
      entityId: row.id,
      after: input,
    });
    return row;
  });
}

/** Corrects an owner's identity and bank details. Audited. */
export async function updateOwner(ctx: TenantCtx, input: In<typeof updateOwnerSchema>) {
  assertCan(ctx, "lease:update");
  const { ownerId, ...values } = input;
  await withTenant(ctx, async (tx) => {
    const before = await loadOwner(tx, ownerId);
    await tx.update(propertyOwner).set(values).where(eq(propertyOwner.id, ownerId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "property_owner.update",
      entityType: OWNER_ENTITY,
      entityId: ownerId,
      before,
      after: values,
    });
  });
}

/**
 * Entrusts a unit to the organization for its owner (CLAUDE.md §7 Rentals): a unit the
 * organization does not own — delivered to its buyer, or in a third party's building — with no
 * other active mandate; signed and started from that day on (not in the future for the
 * signature). Its leases are then the owner's. Audited on the owner.
 */
export async function createMandate(ctx: TenantCtx, input: In<typeof createMandateSchema>) {
  assertCan(ctx, "lease:update");
  assertNotFuture(input.signedOn, "signedOn");
  if (input.startOn < input.signedOn)
    throw invalid("startOn", "mandates.errors.startBeforeSigning");
  return withTenant(ctx, async (tx) => {
    const owner = await loadOwner(tx, input.ownerId);
    const [target] = await tx
      .select({ id: unit.id, code: unit.code, status: unit.status })
      .from(unit)
      .where(and(eq(unit.id, input.unitId), isNull(unit.deletedAt)))
      .for("update");
    if (!target) throw invalid("unitId", "rentals.errors.unitNotFound");
    // The organization's own units are let through ordinary leases.
    if (target.status !== "delivered") throw invalid("unitId", "mandates.errors.notOwned");
    const [taken] = await tx
      .select({ id: managementMandate.id })
      .from(managementMandate)
      .where(and(eq(managementMandate.unitId, target.id), eq(managementMandate.status, "active")));
    if (taken) throw invalid("unitId", "mandates.errors.unitTaken");
    const [row] = await tx
      .insert(managementMandate)
      .values({
        organizationId: ctx.orgId,
        ownerId: owner.id,
        unitId: target.id,
        signedOn: input.signedOn,
        startOn: input.startOn,
        feeRateBp: input.feeRate,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: managementMandate.id });
    if (!row) throw new Error("createMandate: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "management_mandate.create",
      entityType: OWNER_ENTITY,
      entityId: owner.id,
      after: { mandateId: row.id, unit: target.code, ...input },
    });
    return row;
  });
}

/**
 * Ends a mandate (from its start to today, with a reason) once the unit has no active lease
 * under it: end or hand over the lease first. Audited on the owner.
 */
export async function endMandate(ctx: TenantCtx, input: In<typeof endMandateSchema>) {
  assertCan(ctx, "lease:update");
  assertNotFuture(input.endedOn, "endedOn");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(managementMandate)
      .where(eq(managementMandate.id, input.mandateId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    if (current.status !== "active") throw new AppError("CONFLICT", "mandates.errors.ended");
    if (input.endedOn < current.startOn) {
      throw invalid("endedOn", "mandates.errors.endBeforeStart");
    }
    const [leased] = await tx
      .select({ id: lease.id })
      .from(lease)
      .where(and(eq(lease.mandateId, current.id), eq(lease.status, "active")));
    if (leased) throw new AppError("CONFLICT", "mandates.errors.leased");
    await tx
      .update(managementMandate)
      .set({
        status: "ended",
        endedOn: input.endedOn,
        endReason: input.reason,
        endedBy: ctx.userId,
      })
      .where(eq(managementMandate.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "management_mandate.end",
      entityType: OWNER_ENTITY,
      entityId: current.ownerId,
      before: { mandateId: current.id, status: "active" },
      after: { status: "ended", endedOn: input.endedOn },
      reason: input.reason,
    });
  });
}

/** The active mandate of a unit (leases on units the organization does not own). */
export async function activeMandate(tx: Tx, unitId: string) {
  const [row] = await tx
    .select({ id: managementMandate.id, ownerId: managementMandate.ownerId })
    .from(managementMandate)
    .where(and(eq(managementMandate.unitId, unitId), eq(managementMandate.status, "active")));
  return row ?? null;
}
