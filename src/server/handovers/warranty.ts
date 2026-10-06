import "server-only";

import { and, asc, eq, isNull, lt, max, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { handover, project, supplier, unit, user, warrantyClaim } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { runningWarranties } from "@/lib/obligations";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import type { PortalCtx } from "@/server/portal/context";
import { isPortalSale } from "@/server/portal/sales";

import type {
  assignWarrantyClaimSchema,
  fixWarrantyClaimSchema,
  portalWarrantyClaimSchema,
  rejectWarrantyClaimSchema,
  reportWarrantyClaimSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** A signed handover (the PV starts the warranties), locked. */
async function loadSignedHandover(tx: Tx, where: ReturnType<typeof eq>) {
  const [row] = await tx.select().from(handover).where(where).for("update");
  if (!row) throw new AppError("NOT_FOUND");
  if (row.status !== "signed" || !row.signedOn) {
    throw new AppError("CONFLICT", "warranty.errors.notDelivered");
  }
  return { ...row, signedOn: row.signedOn };
}

async function insertClaim(
  tx: Tx,
  actor: { orgId: string; userId: string },
  row: { id: string; signedOn: string },
  input: { location: string; description: string; reportedOn: string; fromPortal: boolean },
) {
  if (input.reportedOn < row.signedOn) {
    throw invalid("reportedOn", "warranty.errors.beforeHandover");
  }
  if (runningWarranties(row.signedOn, input.reportedOn).length === 0) {
    throw new AppError("CONFLICT", "warranty.errors.outOfWarranty");
  }
  const [last] = await tx
    .select({ position: max(warrantyClaim.position) })
    .from(warrantyClaim)
    .where(eq(warrantyClaim.handoverId, row.id));
  const [claim] = await tx
    .insert(warrantyClaim)
    .values({
      organizationId: actor.orgId,
      handoverId: row.id,
      position: (last?.position ?? 0) + 1,
      location: input.location,
      description: input.description,
      reportedOn: input.reportedOn,
      reportedBy: actor.userId,
      fromPortal: input.fromPortal,
    })
    .returning({ id: warrantyClaim.id, position: warrantyClaim.position });
  if (!claim) throw new Error("insertClaim: no row returned");
  await recordAudit(tx, actor, {
    actorUserId: actor.userId,
    action: "warranty_claim.report",
    entityType: "handover",
    entityId: row.id,
    after: { position: claim.position, location: input.location, fromPortal: input.fromPortal },
  });
  return claim;
}

/**
 * A defect reported after the handover by staff (`handover:update`), numbered within the
 * handover; refused once every warranty has run out. Audited.
 */
export async function reportWarrantyClaim(
  ctx: TenantCtx,
  input: In<typeof reportWarrantyClaimSchema>,
) {
  assertCan(ctx, "handover:update");
  if (input.reportedOn > todayInAlgiers())
    throw invalid("reportedOn", "handovers.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    const row = await loadSignedHandover(tx, eq(handover.id, input.handoverId));
    return insertClaim(tx, ctx, row, { ...input, fromPortal: false });
  });
}

/** A buyer reports a defect of their delivered unit from the portal (dated today). */
export async function reportPortalWarrantyClaim(
  ctx: PortalCtx,
  input: In<typeof portalWarrantyClaimSchema>,
) {
  return withTenant(ctx, async (tx) => {
    if (!(await isPortalSale(tx, ctx.userId, input.reservationId))) {
      throw new AppError("NOT_FOUND");
    }
    const row = await loadSignedHandover(tx, eq(handover.reservationId, input.reservationId));
    return insertClaim(tx, ctx, row, {
      location: input.location,
      description: input.description,
      reportedOn: todayInAlgiers(),
      fromPortal: true,
    });
  });
}

async function loadClaim(tx: Tx, claimId: string) {
  const [claim] = await tx
    .select()
    .from(warrantyClaim)
    .where(eq(warrantyClaim.id, claimId))
    .for("update");
  if (!claim) throw new AppError("NOT_FOUND");
  const [row] = await tx
    .select({ signedOn: handover.signedOn })
    .from(handover)
    .where(eq(handover.id, claim.handoverId));
  return { claim, signedOn: row?.signedOn ?? claim.reportedOn };
}

/**
 * Qualifies a claim under a warranty running when it was reported and passes it to a
 * contractor with a deadline (again to reassign it). Audited.
 */
export async function assignWarrantyClaim(
  ctx: TenantCtx,
  input: In<typeof assignWarrantyClaimSchema>,
) {
  assertCan(ctx, "handover:update");
  await withTenant(ctx, async (tx) => {
    const { claim, signedOn } = await loadClaim(tx, input.claimId);
    if (claim.status !== "open" && claim.status !== "assigned") {
      throw new AppError("CONFLICT", "warranty.errors.closed");
    }
    if (!runningWarranties(signedOn, claim.reportedOn).includes(input.warrantyKind)) {
      throw invalid("warrantyKind", "warranty.errors.notCovered");
    }
    const today = todayInAlgiers();
    if (input.dueOn < today) throw invalid("dueOn", "warranty.errors.duePast");
    const [contractor] = await tx
      .select({ id: supplier.id, name: supplier.name })
      .from(supplier)
      .where(and(eq(supplier.id, input.supplierId), isNull(supplier.deletedAt)));
    if (!contractor) throw invalid("supplierId", "warranty.errors.contractor");
    await tx
      .update(warrantyClaim)
      .set({
        status: "assigned",
        warrantyKind: input.warrantyKind,
        supplierId: contractor.id,
        assignedOn: today,
        dueOn: input.dueOn,
        note: input.note,
        updatedAt: new Date(),
      })
      .where(eq(warrantyClaim.id, claim.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "warranty_claim.assign",
      entityType: "handover",
      entityId: claim.handoverId,
      after: {
        position: claim.position,
        warrantyKind: input.warrantyKind,
        contractor: contractor.name,
        dueOn: input.dueOn,
      },
    });
  });
}

/** The contractor fixed it (from its assignment to today). Audited. */
export async function fixWarrantyClaim(ctx: TenantCtx, input: In<typeof fixWarrantyClaimSchema>) {
  assertCan(ctx, "handover:update");
  if (input.fixedOn > todayInAlgiers()) throw invalid("fixedOn", "handovers.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const { claim } = await loadClaim(tx, input.claimId);
    if (claim.status !== "assigned") throw new AppError("CONFLICT", "warranty.errors.notAssigned");
    if (claim.assignedOn && input.fixedOn < claim.assignedOn) {
      throw invalid("fixedOn", "warranty.errors.beforeAssignment");
    }
    await tx
      .update(warrantyClaim)
      .set({
        status: "fixed",
        fixedOn: input.fixedOn,
        note: input.note ?? claim.note,
        updatedAt: new Date(),
      })
      .where(eq(warrantyClaim.id, claim.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "warranty_claim.fix",
      entityType: "handover",
      entityId: claim.handoverId,
      after: { position: claim.position, fixedOn: input.fixedOn },
    });
  });
}

/** Rejected with a reason (outside the warranties, misuse…), shown to the buyer. Audited. */
export async function rejectWarrantyClaim(
  ctx: TenantCtx,
  input: In<typeof rejectWarrantyClaimSchema>,
) {
  assertCan(ctx, "handover:update");
  await withTenant(ctx, async (tx) => {
    const { claim } = await loadClaim(tx, input.claimId);
    if (claim.status !== "open" && claim.status !== "assigned") {
      throw new AppError("CONFLICT", "warranty.errors.closed");
    }
    await tx
      .update(warrantyClaim)
      .set({
        status: "rejected",
        supplierId: null,
        assignedOn: null,
        dueOn: null,
        note: input.note,
        updatedAt: new Date(),
      })
      .where(eq(warrantyClaim.id, claim.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "warranty_claim.reject",
      entityType: "handover",
      entityId: claim.handoverId,
      after: { position: claim.position },
      reason: input.note,
    });
  });
}

const reporter = alias(user, "reporter");

function selectClaims(tx: Tx) {
  return tx
    .select({
      id: warrantyClaim.id,
      handoverId: warrantyClaim.handoverId,
      position: warrantyClaim.position,
      location: warrantyClaim.location,
      description: warrantyClaim.description,
      reportedOn: warrantyClaim.reportedOn,
      reporterName: reporter.name,
      fromPortal: warrantyClaim.fromPortal,
      status: warrantyClaim.status,
      warrantyKind: warrantyClaim.warrantyKind,
      supplierName: supplier.name,
      assignedOn: warrantyClaim.assignedOn,
      dueOn: warrantyClaim.dueOn,
      fixedOn: warrantyClaim.fixedOn,
      note: warrantyClaim.note,
    })
    .from(warrantyClaim)
    .innerJoin(reporter, eq(reporter.id, warrantyClaim.reportedBy))
    .leftJoin(supplier, eq(supplier.id, warrantyClaim.supplierId));
}

/** Claims of a sale's handover (delivery page, `handover:read`). */
export async function listWarrantyClaims(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "handover:read");
  if (!isUuid(reservationId)) return [];
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ id: handover.id })
      .from(handover)
      .where(eq(handover.reservationId, reservationId));
    if (!row) return [];
    return selectClaims(tx)
      .where(eq(warrantyClaim.handoverId, row.id))
      .orderBy(asc(warrantyClaim.position));
  });
}

export type WarrantyClaimRow = Awaited<ReturnType<typeof listWarrantyClaims>>[number];

/** A buyer's claims on one of their sales (portal), without staff names. */
export async function listPortalWarrantyClaims(ctx: PortalCtx, reservationId: string) {
  if (!isUuid(reservationId)) return [];
  return withTenant(ctx, async (tx) => {
    if (!(await isPortalSale(tx, ctx.userId, reservationId))) return [];
    const [row] = await tx
      .select({ id: handover.id })
      .from(handover)
      .where(eq(handover.reservationId, reservationId));
    if (!row) return [];
    return tx
      .select({
        id: warrantyClaim.id,
        position: warrantyClaim.position,
        location: warrantyClaim.location,
        description: warrantyClaim.description,
        reportedOn: warrantyClaim.reportedOn,
        status: warrantyClaim.status,
        dueOn: warrantyClaim.dueOn,
        fixedOn: warrantyClaim.fixedOn,
        note: sql<
          string | null
        >`case when ${warrantyClaim.status} = 'rejected' then ${warrantyClaim.note} end`,
      })
      .from(warrantyClaim)
      .where(eq(warrantyClaim.handoverId, row.id))
      .orderBy(asc(warrantyClaim.position));
  });
}

/** Contractors a claim can be passed to (the organization's suppliers). */
export async function listWarrantyContractors(ctx: TenantCtx) {
  assertCan(ctx, "handover:update");
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: supplier.id, name: supplier.name })
      .from(supplier)
      .where(isNull(supplier.deletedAt))
      .orderBy(asc(supplier.name)),
  );
}

/**
 * Dashboard (`handover:update`): claims to qualify, and claims past the contractor's deadline,
 * with their unit.
 */
export async function loadWarrantyTodo(tx: Tx, ctx: TenantCtx) {
  if (!can(ctx.roles, "handover:update")) return null;
  const today = todayInAlgiers();
  return tx
    .select({
      id: warrantyClaim.id,
      reservationId: handover.reservationId,
      status: warrantyClaim.status,
      dueOn: warrantyClaim.dueOn,
      unitCode: unit.code,
      projectName: project.name,
    })
    .from(warrantyClaim)
    .innerJoin(handover, eq(handover.id, warrantyClaim.handoverId))
    .innerJoin(unit, eq(unit.id, handover.unitId))
    .innerJoin(project, eq(project.id, unit.projectId))
    .where(
      or(
        eq(warrantyClaim.status, "open"),
        and(eq(warrantyClaim.status, "assigned"), lt(warrantyClaim.dueOn, today)),
      ),
    )
    .orderBy(asc(warrantyClaim.reportedOn))
    .limit(20);
}
