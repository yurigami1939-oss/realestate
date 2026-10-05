import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { building, buildingProgress, constructionReport, file, project } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";

import {
  type createReportSchema,
  MAX_REPORT_PHOTOS,
  type reportPhotoSchema,
  type updateReportSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Entity type of the stored site photos (`file.entity_type`). */
export const REPORT_PHOTO_ENTITY = "construction_report";

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

function assertNotFuture(day: string) {
  if (day > todayInAlgiers()) throw invalid("reportedOn", "construction.errors.futureDate");
}

/** A live report of the organization (locked); NOT_FOUND otherwise. */
async function loadReport(tx: Tx, reportId: string) {
  const [row] = await tx
    .select()
    .from(constructionReport)
    .where(and(eq(constructionReport.id, reportId), isNull(constructionReport.deletedAt)))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/**
 * The progress lines to store: buildings left blank are not reported; each reported building
 * must be a live building of the project, once.
 */
async function progressRows(
  tx: Tx,
  projectId: string,
  progress: In<typeof updateReportSchema>["progress"],
) {
  const reported = progress.flatMap((p) =>
    p.percent === null ? [] : [{ buildingId: p.buildingId, percent: p.percent }],
  );
  const ids = reported.map((p) => p.buildingId);
  if (new Set(ids).size !== ids.length) {
    throw invalid("progress", "construction.errors.buildingNotFound");
  }
  if (ids.length === 0) return reported;
  const live = await tx
    .select({ id: building.id })
    .from(building)
    .where(
      and(eq(building.projectId, projectId), inArray(building.id, ids), isNull(building.deletedAt)),
    );
  if (live.length !== ids.length) throw invalid("progress", "construction.errors.buildingNotFound");
  return reported;
}

async function writeProgress(
  tx: Tx,
  ctx: TenantCtx,
  report: { id: string; projectId: string },
  rows: { buildingId: string; percent: number }[],
) {
  await tx.delete(buildingProgress).where(eq(buildingProgress.reportId, report.id));
  if (rows.length === 0) return;
  await tx.insert(buildingProgress).values(
    rows.map((r) => ({
      ...r,
      organizationId: ctx.orgId,
      reportId: report.id,
      projectId: report.projectId,
    })),
  );
}

/** New progress report of a project, with the progress of the buildings it reports on. */
export async function createConstructionReport(
  ctx: TenantCtx,
  input: In<typeof createReportSchema>,
) {
  assertCan(ctx, "construction:update");
  assertNotFuture(input.reportedOn);
  const { projectId, progress, ...fields } = input;
  return withTenant(ctx, async (tx) => {
    const [target] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), isNull(project.deletedAt)));
    if (!target) throw new AppError("NOT_FOUND");
    const rows = await progressRows(tx, projectId, progress);
    const [row] = await tx
      .insert(constructionReport)
      .values({ ...fields, organizationId: ctx.orgId, projectId, createdBy: ctx.userId })
      .returning({ id: constructionReport.id });
    if (!row) throw new Error("createConstructionReport: no row returned");
    await writeProgress(tx, ctx, { id: row.id, projectId }, rows);
    return { id: row.id };
  });
}

/** Rewrites a report (text, date, visibility) and its progress lines as a whole. */
export async function updateConstructionReport(
  ctx: TenantCtx,
  input: In<typeof updateReportSchema>,
) {
  assertCan(ctx, "construction:update");
  assertNotFuture(input.reportedOn);
  const { reportId, progress, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    const report = await loadReport(tx, reportId);
    const rows = await progressRows(tx, report.projectId, progress);
    await tx.update(constructionReport).set(fields).where(eq(constructionReport.id, reportId));
    await writeProgress(tx, ctx, report, rows);
  });
}

/** Removes a report from the follow-up and the portal (soft delete); its photos are discarded. */
export async function deleteConstructionReport(ctx: TenantCtx, reportId: string) {
  assertCan(ctx, "construction:update");
  await withTenant(ctx, async (tx) => {
    await loadReport(tx, reportId);
    await tx
      .update(constructionReport)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(constructionReport.id, reportId));
    await tx
      .update(file)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(file.entityType, REPORT_PHOTO_ENTITY),
          eq(file.entityId, reportId),
          isNull(file.deletedAt),
        ),
      );
  });
}

/** Adds a site photo (JPEG, PNG or WebP) to a report, up to MAX_REPORT_PHOTOS. */
export async function addReportPhoto(
  ctx: TenantCtx,
  input: { reportId: string; upload: Upload },
): Promise<{ fileId: string }> {
  assertCan(ctx, "construction:update");
  const contentType = checkUpload("construction_report.photo", input.upload);
  return withTenant(ctx, async (tx) => {
    await loadReport(tx, input.reportId);
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(file)
      .where(
        and(
          eq(file.entityType, REPORT_PHOTO_ENTITY),
          eq(file.entityId, input.reportId),
          isNull(file.deletedAt),
        ),
      );
    if (count >= MAX_REPORT_PHOTOS) {
      throw new AppError("CONFLICT", "construction.errors.tooManyPhotos");
    }
    const stored = await storeFile(tx, ctx, {
      entityType: REPORT_PHOTO_ENTITY,
      entityId: input.reportId,
      upload: input.upload,
      contentType,
    });
    return { fileId: stored.id };
  });
}

/** Removes a photo from its report (the object stays in the bucket). */
export async function removeReportPhoto(ctx: TenantCtx, input: In<typeof reportPhotoSchema>) {
  assertCan(ctx, "construction:update");
  await withTenant(ctx, async (tx) => {
    await loadReport(tx, input.reportId);
    const [photo] = await tx
      .select({ id: file.id })
      .from(file)
      .where(
        and(
          eq(file.id, input.fileId),
          eq(file.entityType, REPORT_PHOTO_ENTITY),
          eq(file.entityId, input.reportId),
          isNull(file.deletedAt),
        ),
      );
    if (!photo) throw new AppError("NOT_FOUND");
    await discardFile(tx, photo.id);
  });
}
