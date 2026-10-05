import "server-only";

import { and, asc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Tx } from "@/db/client";
import { file, handover, project, projectDocument, reservation } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, type CalendarDate } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { EXPIRY_WARNING_DAYS, essentialProjectDocuments } from "@/lib/obligations";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { visibleSales } from "@/server/sales/access";

const scan = alias(file, "scan");

/** A project's regulatory file, by kind, with each document's scan. */
export async function listProjectDocuments(ctx: TenantCtx, projectId: string) {
  assertCan(ctx, "inventory:read");
  if (!isUuid(projectId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: projectDocument.id,
        kind: projectDocument.kind,
        title: projectDocument.title,
        reference: projectDocument.reference,
        issuedOn: projectDocument.issuedOn,
        expiresOn: projectDocument.expiresOn,
        issuer: projectDocument.issuer,
        notes: projectDocument.notes,
        scanFileId: projectDocument.scanFileId,
        scanFileName: scan.fileName,
      })
      .from(projectDocument)
      .leftJoin(scan, eq(scan.id, projectDocument.scanFileId))
      .where(and(eq(projectDocument.projectId, projectId), isNull(projectDocument.deletedAt)))
      .orderBy(asc(projectDocument.kind), asc(projectDocument.issuedOn)),
  );
}

export type ProjectDocumentRow = Awaited<ReturnType<typeof listProjectDocuments>>[number];

/**
 * Dashboard to-dos of the regulatory files: documents expired or expiring within 60 days, and
 * projects not delivered yet that miss an essential document.
 */
export async function loadDocumentAlerts(tx: Tx, today: CalendarDate) {
  const [expiring] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(projectDocument)
    .innerJoin(project, eq(project.id, projectDocument.projectId))
    .where(
      and(
        isNull(projectDocument.deletedAt),
        isNull(project.deletedAt),
        lt(projectDocument.expiresOn, addDays(today, EXPIRY_WARNING_DAYS + 1)),
      ),
    );
  const projects = await tx
    .select({ id: project.id })
    .from(project)
    .where(and(isNull(project.deletedAt), ne(project.status, "delivered")));
  const held =
    projects.length === 0
      ? []
      : await tx
          .selectDistinct({ projectId: projectDocument.projectId, kind: projectDocument.kind })
          .from(projectDocument)
          .where(
            and(
              isNull(projectDocument.deletedAt),
              inArray(
                projectDocument.projectId,
                projects.map((p) => p.id),
              ),
            ),
          );
  const incomplete = projects.filter((p) =>
    essentialProjectDocuments.some(
      (kind) => !held.some((h) => h.projectId === p.id && h.kind === kind),
    ),
  ).length;
  return { expiring: expiring?.count ?? 0, incomplete };
}

/**
 * Sold units past their contractual delivery date and not handed over yet (the indemnity owed
 * to their buyers grows each day), for the dashboard.
 */
export async function countLateDeliveries(tx: Tx, ctx: TenantCtx, today: CalendarDate) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(reservation)
    .leftJoin(
      handover,
      and(eq(handover.reservationId, reservation.id), eq(handover.status, "signed")),
    )
    .where(
      and(
        eq(reservation.status, "sold"),
        lt(reservation.deliveryDueOn, today),
        isNull(handover.id),
        visibleSales(ctx),
      ),
    );
  return row?.count ?? 0;
}
