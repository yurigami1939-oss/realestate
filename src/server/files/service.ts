import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { buyer, file, lead, quotation, reservation } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  cleanFileName,
  sniffContentType,
  uploadPurposes,
  type FileContentType,
  type UploadPurpose,
} from "@/lib/files";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import type { TenantCtx } from "@/server/auth/session";
import { visibleBuyers } from "@/server/buyers/access";
import { visibleLeads } from "@/server/crm/access";
import { visibleSales } from "@/server/sales/access";

import { presignDownload, putObject, storageKey } from "./storage";

/** A file received by the upload Route Handler, not yet checked. */
export type Upload = { fileName: string; bytes: Uint8Array };

type Reader = (tx: Tx, ctx: TenantCtx, entityId: string) => Promise<boolean>;

/** Who may download a file, by the kind of record it belongs to. Unknown kinds: nobody. */
const readers: Record<string, Reader> = {
  // The company logo: any member of the organization.
  organization: async (_tx, ctx, entityId) => entityId === ctx.orgId,
  unit: async (_tx, ctx) => can(ctx.roles, "inventory:read"),
  // A buyer's scans follow the buyer: commercials only see the buyers they follow.
  buyer: async (tx, ctx, entityId) => {
    if (!can(ctx.roles, "buyer:read")) return false;
    const [row] = await tx
      .select({ id: buyer.id })
      .from(buyer)
      .where(and(eq(buyer.id, entityId), visibleBuyers(ctx)));
    return row !== undefined;
  },
  // Sale documents (contract scans, sheets, receipts…) follow the sale's visibility.
  reservation: async (tx, ctx, entityId) => {
    if (!can(ctx.roles, "sale:read")) return false;
    const [row] = await tx
      .select({ id: reservation.id })
      .from(reservation)
      .where(and(eq(reservation.id, entityId), visibleSales(ctx)));
    return row !== undefined;
  },
  // Residence documents (charge calls, receipts, reminders): residence finance readers.
  residence: async (_tx, ctx) => can(ctx.roles, "charge:read"),
  // A quotation PDF follows its lead: commercials only see their own leads' quotations.
  quotation: async (tx, ctx, entityId) => {
    if (!can(ctx.roles, "lead:read")) return false;
    const [row] = await tx
      .select({ id: quotation.id })
      .from(quotation)
      .innerJoin(lead, eq(lead.id, quotation.leadId))
      .where(and(eq(quotation.id, entityId), visibleLeads(ctx)));
    return row !== undefined;
  },
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
  /** `userId` is null for background jobs (e.g. a rendered document). */
  actor: { orgId: string; userId: string | null },
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
        entityId: file.entityId,
      })
      .from(file)
      .where(and(eq(file.id, fileId), isNull(file.deletedAt)));
    if (!found) throw new AppError("NOT_FOUND");
    const reader = readers[found.entityType];
    if (!reader || !(await reader(tx, ctx, found.entityId))) throw new AppError("FORBIDDEN");
    return found;
  });
  return presignDownload({ ...row, disposition });
}
