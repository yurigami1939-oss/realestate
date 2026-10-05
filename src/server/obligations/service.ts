import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { project, projectDocument } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";

import type {
  createProjectDocumentSchema,
  projectDocumentIdSchema,
  updateProjectDocumentSchema,
} from "./schemas";

type CreateInput = z.output<typeof createProjectDocumentSchema>;
type UpdateInput = z.output<typeof updateProjectDocumentSchema>;

async function loadDocument(tx: Tx, documentId: string, options: { forUpdate?: boolean } = {}) {
  const query = tx
    .select()
    .from(projectDocument)
    .where(and(eq(projectDocument.id, documentId), isNull(projectDocument.deletedAt)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

const fieldsOf = (input: Omit<CreateInput, "projectId"> | Omit<UpdateInput, "documentId">) => ({
  kind: input.kind,
  title: input.title,
  reference: input.reference,
  issuedOn: input.issuedOn,
  expiresOn: input.expiresOn,
  issuer: input.issuer,
  notes: input.notes,
});

/** Adds a document to a project's regulatory file (audited `project_document.create`). */
export async function createProjectDocument(ctx: TenantCtx, input: CreateInput) {
  assertCan(ctx, "project:update");
  return withTenant(ctx, async (tx) => {
    const [owner] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, input.projectId), isNull(project.deletedAt)));
    if (!owner) throw new AppError("NOT_FOUND");
    const values = fieldsOf(input);
    const [row] = await tx
      .insert(projectDocument)
      .values({
        organizationId: ctx.orgId,
        projectId: input.projectId,
        ...values,
        createdBy: ctx.userId,
      })
      .returning({ id: projectDocument.id });
    if (!row) throw new Error("createProjectDocument: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "project_document.create",
      entityType: "project",
      entityId: input.projectId,
      after: { id: row.id, ...values },
    });
    return { id: row.id };
  });
}

/** Corrects a document (reference, dates, issuer…), audited with before / after. */
export async function updateProjectDocument(ctx: TenantCtx, input: UpdateInput) {
  assertCan(ctx, "project:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadDocument(tx, input.documentId, { forUpdate: true });
    const values = fieldsOf(input);
    await tx
      .update(projectDocument)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(projectDocument.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "project_document.update",
      entityType: "project",
      entityId: current.projectId,
      before: fieldsOf(current),
      after: { id: current.id, ...values },
    });
  });
}

/** Removes a document from the file (soft delete; its scan stays stored). */
export async function deleteProjectDocument(
  ctx: TenantCtx,
  input: z.output<typeof projectDocumentIdSchema>,
) {
  assertCan(ctx, "project:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadDocument(tx, input.documentId, { forUpdate: true });
    await tx
      .update(projectDocument)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(projectDocument.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "project_document.delete",
      entityType: "project",
      entityId: current.projectId,
      before: { id: current.id, ...fieldsOf(current) },
    });
  });
}

/** Attaches or replaces a document's scan (the previous one is discarded). */
export async function setProjectDocumentScan(
  ctx: TenantCtx,
  input: { documentId: string; upload: Upload },
) {
  assertCan(ctx, "project:update");
  const contentType = checkUpload("project_document.scan", input.upload);
  return withTenant(ctx, async (tx) => {
    const current = await loadDocument(tx, input.documentId, { forUpdate: true });
    const stored = await storeFile(tx, ctx, {
      entityType: "project_document",
      entityId: current.id,
      upload: input.upload,
      contentType,
    });
    await tx
      .update(projectDocument)
      .set({ scanFileId: stored.id, updatedAt: new Date() })
      .where(eq(projectDocument.id, current.id));
    if (current.scanFileId) await discardFile(tx, current.scanFileId);
    return { fileId: stored.id };
  });
}
