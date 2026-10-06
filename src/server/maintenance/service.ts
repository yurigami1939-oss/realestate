import "server-only";

import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { residence, residenceCheck, residenceCheckVisit, supplier, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { CHECK_SOON_DAYS, checkState } from "@/lib/maintenance";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";
import { loadResidence } from "@/server/residences/service";

import type {
  checkIdSchema,
  createCheckSchema,
  recordVisitSchema,
  updateCheckSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

async function loadCheck(tx: Tx, checkId: string) {
  if (!isUuid(checkId)) throw new AppError("NOT_FOUND");
  const [row] = await tx
    .select()
    .from(residenceCheck)
    .where(eq(residenceCheck.id, checkId))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** A supplier of the organization (the composite FK keeps it in the tenant). */
async function assertSupplier(tx: Tx, supplierId: string | null) {
  if (!supplierId) return;
  const [row] = await tx
    .select({ id: supplier.id })
    .from(supplier)
    .where(and(eq(supplier.id, supplierId), isNull(supplier.deletedAt)));
  if (!row) throw invalid("supplierId", "maintenance.errors.supplier");
}

/**
 * A deadline of a residence (`residence:update`: gérant, gestionnaire): its insurance, a
 * regulatory inspection or a maintenance visit, with a frequency and the next due day. Audited.
 */
export async function createCheck(ctx: TenantCtx, input: In<typeof createCheckSchema>) {
  assertCan(ctx, "residence:update");
  return withTenant(ctx, async (tx) => {
    const home = await loadResidence(tx, input.residenceId);
    await assertSupplier(tx, input.supplierId);
    const { residenceId: _residenceId, ...fields } = input;
    const [row] = await tx
      .insert(residenceCheck)
      .values({
        organizationId: ctx.orgId,
        residenceId: home.id,
        ...fields,
        createdBy: ctx.userId,
      })
      .returning({ id: residenceCheck.id });
    if (!row) throw new Error("createCheck: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "residence_check.create",
      entityType: "residence",
      entityId: home.id,
      after: { id: row.id, ...fields },
    });
    return { id: row.id };
  });
}

/** Corrected while not archived (its visits stay as recorded). Audited. */
export async function updateCheck(ctx: TenantCtx, input: In<typeof updateCheckSchema>) {
  assertCan(ctx, "residence:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadCheck(tx, input.checkId);
    if (current.archivedAt) throw new AppError("CONFLICT", "maintenance.errors.archived");
    await assertSupplier(tx, input.supplierId);
    const { checkId: _checkId, ...fields } = input;
    await tx
      .update(residenceCheck)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(residenceCheck.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "residence_check.update",
      entityType: "residence",
      entityId: current.residenceId,
      before: {
        id: current.id,
        title: current.title,
        frequencyMonths: current.frequencyMonths,
        nextDueOn: current.nextDueOn,
      },
      after: fields,
    });
  });
}

/** No longer followed (a lift removed, a policy replaced): archived with its history. */
export async function archiveCheck(ctx: TenantCtx, input: In<typeof checkIdSchema>) {
  assertCan(ctx, "residence:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadCheck(tx, input.checkId);
    if (current.archivedAt) throw new AppError("CONFLICT", "maintenance.errors.archived");
    await tx
      .update(residenceCheck)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(residenceCheck.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "residence_check.archive",
      entityType: "residence",
      entityId: current.residenceId,
      before: { id: current.id, title: current.title },
    });
  });
}

/**
 * A visit done (inspection passed, policy renewed, maintenance carried out): not in the future,
 * the next deadline after it; the check moves to that deadline. Audited.
 */
export async function recordVisit(ctx: TenantCtx, input: In<typeof recordVisitSchema>) {
  assertCan(ctx, "residence:update");
  if (input.doneOn > todayInAlgiers()) throw invalid("doneOn", "sales.errors.futureDate");
  if (input.nextDueOn <= input.doneOn) {
    throw invalid("nextDueOn", "maintenance.errors.nextBeforeVisit");
  }
  return withTenant(ctx, async (tx) => {
    const current = await loadCheck(tx, input.checkId);
    if (current.archivedAt) throw new AppError("CONFLICT", "maintenance.errors.archived");
    await assertSupplier(tx, input.supplierId);
    const [row] = await tx
      .insert(residenceCheckVisit)
      .values({
        organizationId: ctx.orgId,
        checkId: current.id,
        doneOn: input.doneOn,
        supplierId: input.supplierId ?? current.supplierId,
        result: input.result,
        notes: input.notes,
        cost: input.cost,
        nextDueOn: input.nextDueOn,
        recordedBy: ctx.userId,
      })
      .returning({ id: residenceCheckVisit.id });
    if (!row) throw new Error("recordVisit: no row returned");
    await tx
      .update(residenceCheck)
      .set({ nextDueOn: input.nextDueOn, updatedAt: new Date() })
      .where(eq(residenceCheck.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "residence_check.visit",
      entityType: "residence",
      entityId: current.residenceId,
      after: { ...input, title: current.title },
    });
    return { id: row.id };
  });
}

/** The certificate or report of a visit (PDF or image), replaced at any time. */
export async function setVisitScan(
  ctx: TenantCtx,
  input: { visitId: string; upload: Upload },
): Promise<{ fileId: string }> {
  assertCan(ctx, "residence:update");
  const contentType = checkUpload("residence_check.scan", input.upload);
  if (!isUuid(input.visitId)) throw new AppError("NOT_FOUND");
  return withTenant(ctx, async (tx) => {
    const [visit] = await tx
      .select({
        id: residenceCheckVisit.id,
        checkId: residenceCheckVisit.checkId,
        scanFileId: residenceCheckVisit.scanFileId,
      })
      .from(residenceCheckVisit)
      .where(eq(residenceCheckVisit.id, input.visitId))
      .for("update");
    if (!visit) throw new AppError("NOT_FOUND");
    const stored = await storeFile(tx, ctx, {
      entityType: "residence_check",
      entityId: visit.checkId,
      upload: input.upload,
      contentType,
    });
    await tx
      .update(residenceCheckVisit)
      .set({ scanFileId: stored.id })
      .where(eq(residenceCheckVisit.id, visit.id));
    if (visit.scanFileId) await discardFile(tx, visit.scanFileId);
    return { fileId: stored.id };
  });
}

/**
 * The checks followed (`residence:read`), of one residence or all, by next deadline, with their
 * state today and their latest visit; archived ones only when asked.
 */
export async function listChecks(
  ctx: TenantCtx,
  options: { residenceId?: string; archived?: boolean } = {},
) {
  assertCan(ctx, "residence:read");
  if (options.residenceId !== undefined && !isUuid(options.residenceId)) return [];
  const today = todayInAlgiers();
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: residenceCheck.id,
        residenceId: residenceCheck.residenceId,
        residenceName: residence.name,
        kind: residenceCheck.kind,
        category: residenceCheck.category,
        title: residenceCheck.title,
        supplierId: residenceCheck.supplierId,
        supplierName: supplier.name,
        frequencyMonths: residenceCheck.frequencyMonths,
        nextDueOn: residenceCheck.nextDueOn,
        reference: residenceCheck.reference,
        notes: residenceCheck.notes,
        archivedAt: residenceCheck.archivedAt,
      })
      .from(residenceCheck)
      .innerJoin(residence, eq(residence.id, residenceCheck.residenceId))
      .leftJoin(supplier, eq(supplier.id, residenceCheck.supplierId))
      .where(
        and(
          options.residenceId ? eq(residenceCheck.residenceId, options.residenceId) : undefined,
          options.archived ? undefined : isNull(residenceCheck.archivedAt),
          isNull(residence.deletedAt),
        ),
      )
      .orderBy(asc(residenceCheck.nextDueOn), asc(residenceCheck.title));
    const visits =
      rows.length === 0
        ? []
        : await tx
            .select({
              id: residenceCheckVisit.id,
              checkId: residenceCheckVisit.checkId,
              doneOn: residenceCheckVisit.doneOn,
              result: residenceCheckVisit.result,
              notes: residenceCheckVisit.notes,
              cost: residenceCheckVisit.cost,
              scanFileId: residenceCheckVisit.scanFileId,
              supplierName: supplier.name,
              recordedByName: user.name,
            })
            .from(residenceCheckVisit)
            .innerJoin(residenceCheck, eq(residenceCheck.id, residenceCheckVisit.checkId))
            .innerJoin(user, eq(user.id, residenceCheckVisit.recordedBy))
            .leftJoin(supplier, eq(supplier.id, residenceCheckVisit.supplierId))
            .where(
              options.residenceId ? eq(residenceCheck.residenceId, options.residenceId) : undefined,
            )
            .orderBy(desc(residenceCheckVisit.doneOn), desc(residenceCheckVisit.createdAt));
    return rows.map((row) => ({
      ...row,
      state: row.archivedAt ? null : checkState(row.nextDueOn, today),
      visits: visits.filter((v) => v.checkId === row.id).slice(0, 5),
    }));
  });
}

export type CheckRow = Awaited<ReturnType<typeof listChecks>>[number];

/** Dashboard: checks late or due within `CHECK_SOON_DAYS` (who keeps the residences). */
export async function loadCheckTodo(tx: Tx, ctx: TenantCtx) {
  if (!can(ctx.roles, "residence:update")) return null;
  const today = todayInAlgiers();
  const rows = await tx
    .select({
      id: residenceCheck.id,
      residenceId: residenceCheck.residenceId,
      residenceName: residence.name,
      title: residenceCheck.title,
      nextDueOn: residenceCheck.nextDueOn,
    })
    .from(residenceCheck)
    .innerJoin(residence, eq(residence.id, residenceCheck.residenceId))
    .where(
      and(
        isNull(residenceCheck.archivedAt),
        isNull(residence.deletedAt),
        lte(residenceCheck.nextDueOn, addDays(today, CHECK_SOON_DAYS)),
      ),
    )
    .orderBy(asc(residenceCheck.nextDueOn))
    .limit(10);
  return rows.map((r) => ({ ...r, late: r.nextDueOn < today }));
}
