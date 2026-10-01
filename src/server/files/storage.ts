import "server-only";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { contentDisposition, fileFormats, type FileContentType } from "@/lib/files";

import { bucket, s3 } from "./s3";

/** Presigned download links live 5 minutes (CLAUDE.md §5 Files). */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/** `org/{orgId}/{entityType}/{entityId}/{fileId}.{ext}` */
export function storageKey(parts: {
  orgId: string;
  entityType: string;
  entityId: string;
  fileId: string;
  contentType: FileContentType;
}): string {
  const ext = fileFormats[parts.contentType];
  return `org/${parts.orgId}/${parts.entityType}/${parts.entityId}/${parts.fileId}.${ext}`;
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Whole object (small files only: e.g. the logo embedded in documents). */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`getObjectBytes: no body for ${key}`);
  return response.Body.transformToByteArray();
}

/** Short-lived GET link; the browser gets the original file name and type. */
export function presignDownload(file: {
  storageKey: string;
  fileName: string;
  contentType: string;
  disposition: "inline" | "attachment";
}): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: file.storageKey,
      ResponseContentType: file.contentType,
      ResponseContentDisposition: contentDisposition(file.disposition, file.fileName),
      ResponseCacheControl: "private, max-age=300",
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  );
}
