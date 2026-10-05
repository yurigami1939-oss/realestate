import "server-only";

import { and, asc, count, desc, eq, inArray, isNull, max } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  building,
  buildingProgress,
  constructionMilestone,
  constructionReport,
  file,
  project,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadMilestones } from "@/server/payment-plans/queries";

import { REPORT_PHOTO_ENTITY } from "./service";

export type BuildingProgress = { percent: number; reportedOn: string };

/**
 * Current progress of each building of these projects: the one of its latest live report
 * (published ones only for the portal).
 */
export async function latestProgress(
  tx: Tx,
  projectIds: string[],
  options: { publishedOnly?: boolean } = {},
): Promise<Map<string, BuildingProgress>> {
  if (projectIds.length === 0) return new Map();
  const rows = await tx
    .selectDistinctOn([buildingProgress.buildingId], {
      buildingId: buildingProgress.buildingId,
      percent: buildingProgress.percent,
      reportedOn: constructionReport.reportedOn,
    })
    .from(buildingProgress)
    .innerJoin(constructionReport, eq(constructionReport.id, buildingProgress.reportId))
    .where(
      and(
        inArray(buildingProgress.projectId, projectIds),
        isNull(constructionReport.deletedAt),
        options.publishedOnly ? eq(constructionReport.published, true) : undefined,
      ),
    )
    .orderBy(
      asc(buildingProgress.buildingId),
      desc(constructionReport.reportedOn),
      desc(constructionReport.createdAt),
    );
  return new Map(rows.map(({ buildingId, ...p }) => [buildingId, p]));
}

/**
 * Live reports of a project, newest first, with the progress lines and photos of each
 * (published ones only for the portal).
 */
export async function loadReports(
  tx: Tx,
  projectId: string,
  options: { publishedOnly?: boolean; limit?: number } = {},
) {
  const query = tx
    .select({
      id: constructionReport.id,
      reportedOn: constructionReport.reportedOn,
      title: constructionReport.title,
      titleAr: constructionReport.titleAr,
      body: constructionReport.body,
      bodyAr: constructionReport.bodyAr,
      published: constructionReport.published,
    })
    .from(constructionReport)
    .where(
      and(
        eq(constructionReport.projectId, projectId),
        isNull(constructionReport.deletedAt),
        options.publishedOnly ? eq(constructionReport.published, true) : undefined,
      ),
    )
    .orderBy(desc(constructionReport.reportedOn), desc(constructionReport.createdAt));
  const reports = options.limit ? await query.limit(options.limit) : await query;
  if (reports.length === 0) return [];
  const ids = reports.map((r) => r.id);
  const progress = await tx
    .select({
      reportId: buildingProgress.reportId,
      buildingId: buildingProgress.buildingId,
      buildingName: building.name,
      percent: buildingProgress.percent,
    })
    .from(buildingProgress)
    .innerJoin(building, eq(building.id, buildingProgress.buildingId))
    .where(inArray(buildingProgress.reportId, ids))
    .orderBy(asc(building.code));
  const photos = await tx
    .select({ id: file.id, reportId: file.entityId, fileName: file.fileName })
    .from(file)
    .where(
      and(
        eq(file.entityType, REPORT_PHOTO_ENTITY),
        inArray(file.entityId, ids),
        isNull(file.deletedAt),
      ),
    )
    .orderBy(asc(file.createdAt));
  return reports.map((r) => ({
    ...r,
    progress: progress.filter((p) => p.reportId === r.id).map(({ reportId: _r, ...p }) => p),
    photos: photos.filter((p) => p.reportId === r.id).map(({ reportId: _r, ...p }) => p),
  }));
}

export type ConstructionReportRow = Awaited<ReturnType<typeof loadReports>>[number];

const liveBuildings = (tx: Tx, projectIds: string[]) =>
  tx
    .select({
      id: building.id,
      projectId: building.projectId,
      code: building.code,
      name: building.name,
    })
    .from(building)
    .where(and(inArray(building.projectId, projectIds), isNull(building.deletedAt)))
    .orderBy(asc(building.code));

/**
 * Construction overview (construction:read): every live project with its buildings' current
 * progress, its last report and its next milestone.
 */
export async function listConstructionOverview(ctx: TenantCtx) {
  assertCan(ctx, "construction:read");
  return withTenant(ctx, async (tx) => {
    const projects = await tx
      .select({
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
        plannedDeliveryOn: project.plannedDeliveryOn,
      })
      .from(project)
      .where(isNull(project.deletedAt))
      .orderBy(asc(project.name));
    const ids = projects.map((p) => p.id);
    if (ids.length === 0) return [];
    const buildings = await liveBuildings(tx, ids);
    const progress = await latestProgress(tx, ids);
    const reports = await tx
      .select({
        projectId: constructionReport.projectId,
        count: count(),
        lastOn: max(constructionReport.reportedOn),
      })
      .from(constructionReport)
      .where(and(inArray(constructionReport.projectId, ids), isNull(constructionReport.deletedAt)))
      .groupBy(constructionReport.projectId);
    const milestones = await tx
      .select({
        projectId: constructionMilestone.projectId,
        name: constructionMilestone.name,
        plannedOn: constructionMilestone.plannedOn,
        validatedOn: constructionMilestone.validatedOn,
      })
      .from(constructionMilestone)
      .where(
        and(inArray(constructionMilestone.projectId, ids), isNull(constructionMilestone.deletedAt)),
      )
      .orderBy(asc(constructionMilestone.position));
    return projects.map((p) => {
      const own = milestones.filter((m) => m.projectId === p.id);
      const report = reports.find((r) => r.projectId === p.id);
      return {
        ...p,
        buildings: buildings
          .filter((b) => b.projectId === p.id)
          .map((b) => ({ id: b.id, name: b.name, progress: progress.get(b.id) ?? null })),
        reports: report?.count ?? 0,
        lastReportOn: report?.lastOn ?? null,
        milestonesDone: own.filter((m) => m.validatedOn !== null).length,
        milestones: own.length,
        nextMilestone: own.find((m) => m.validatedOn === null) ?? null,
      };
    });
  });
}

export type ConstructionOverview = Awaited<ReturnType<typeof listConstructionOverview>>;

/**
 * A project's construction follow-up (construction:read): its buildings with their current
 * progress, its milestones and its reports (the latest `limit` ones), newest first.
 */
export async function getProjectConstruction(
  ctx: TenantCtx,
  projectId: string,
  options: { limit?: number } = {},
) {
  assertCan(ctx, "construction:read");
  if (!isUuid(projectId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
        plannedDeliveryOn: project.plannedDeliveryOn,
      })
      .from(project)
      .where(and(eq(project.id, projectId), isNull(project.deletedAt)));
    if (!row) return null;
    const progress = await latestProgress(tx, [projectId]);
    const buildings = (await liveBuildings(tx, [projectId])).map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      progress: progress.get(b.id) ?? null,
    }));
    const [{ total } = { total: 0 }] = await tx
      .select({ total: count() })
      .from(constructionReport)
      .where(
        and(eq(constructionReport.projectId, projectId), isNull(constructionReport.deletedAt)),
      );
    return {
      ...row,
      buildings,
      milestones: await loadMilestones(tx, projectId),
      reports: await loadReports(tx, projectId, { limit: options.limit }),
      totalReports: total,
    };
  });
}

export type ProjectConstruction = NonNullable<Awaited<ReturnType<typeof getProjectConstruction>>>;
