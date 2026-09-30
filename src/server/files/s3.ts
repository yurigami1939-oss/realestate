import "server-only";

import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import { env } from "@/env";

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  // S3-compatible stores do not all support the SDK's default CRC checksums.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export const bucket = env.S3_BUCKET;

/** Creates the private bucket if it does not exist yet. Idempotent. */
export async function ensureBucket(): Promise<"exists" | "created"> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return "exists";
  } catch (error) {
    const status = error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
    if (status !== 404) throw error;
  }
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  return "created";
}
