import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { file } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  cleanFileName,
  sniffContentType,
  uploadPurposes,
  type FileContentType,
  type UploadPurpose,
} from "@/lib/files";
import type { Permission } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { presignDownload, putObject, storageKey } from "./storage";

/** A file received by the upload Route Handler, not yet checked. */
export type Upload = { fileName: string; bytes: Uint8Array };

/** Permission needed to download a file, by the kind of record it belongs to. */
const readPermission: Record<string, Permission> = {
  unit: "inventory:read",
};

const invalidFile = (messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { file: [messageKey] } });

/** Checks size and real format (magic bytes) against the purpose's rules. */
export function checkUpload(purpose: UploadPurpose, upload: Upload): FileContentType {
  const rules = uploadPurposes[purpose];
  if (upload.bytes.byteLength === 0) throw invalidFile("files.errors.empty");
  if (upload.bytes.byteLength > rules.maxBytes) throw invalidFile("files.errors.tooLarge");
  const contentType = sniffContentType(upload.bytes);
  if (!contentType || !(rules.accept as readonly string[]).includes(contentType)) {
    throw invalidFile("files.errors.type");
  }
  return contentType;
}

/**
 * Inserts the `file` row and uploads the bytes, inside the caller's tenant transaction.
 * The upload runs last, so a failed upload rolls the row back; an object whose transaction
 * later fails to commit is orphaned but unreachable (no row points to it).
 */
export async function storeFile(
  tx: Tx,
  actor: Pick<TenantCtx, "orgId" | "userId">,
  input: {
    entityType: string;
    entityId: string;
    upload: Upload;
    contentType: FileContentType;
  },
): Promise<{ id: string }> {
  const { rows } = await tx.execute<{ id: string }>(sql`select uuidv7() as id`);
  const fileId = rows[0]?.id;
  if (!fileId) throw new Error("storeFile: uuidv7() returned nothing");
  const key = storageKey({ orgId: actor.orgId, fileId, ...input });

  await tx.insert(file).values({
    id: fileId,
    organizationId: actor.orgId,
    storageKey: key,
    fileName: cleanFileName(input.upload.fileName),
    contentType: input.contentType,
    sizeBytes: input.upload.bytes.byteLength,
    entityType: input.entityType,
    entityId: input.entityId,
    uploadedBy: actor.userId,
  });
  await putObject(key, input.upload.bytes, input.contentType);
  return { id: fileId };
}

/** Hides a file from the app. The object stays in the bucket (history, legal retention). */
export async function discardFile(tx: Tx, fileId: string) {
  await tx
    .update(file)
    .set({ deletedAt: new Date() })
    .where(and(eq(file.id, fileId), isNull(file.deletedAt)));
}

/** Presigned download link, after checking the reader may see the file's owner record. */
export async function getFileDownloadUrl(
  ctx: TenantCtx,
  fileId: string,
  disposition: "inline" | "attachment",
): Promise<string> {
  const row = await withTenant(ctx, async (tx) => {
    const [found] = await tx
      .select({
        storageKey: file.storageKey,
        fileName: file.fileName,
        contentType: file.contentType,
        entityType: file.entityType,
      })
      .from(file)
      .where(and(eq(file.id, fileId), isNull(file.deletedAt)));
    return found;
  });
  if (!row) throw new AppError("NOT_FOUND");
  const permission = readPermission[row.entityType];
  if (!permission) throw new AppError("FORBIDDEN");
  assertCan(ctx, permission);
  return presignDownload({ ...row, disposition });
}
