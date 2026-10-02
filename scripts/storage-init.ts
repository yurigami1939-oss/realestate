/** Creates the S3 bucket once the storage container accepts requests. Run by `pnpm docker:up`. */
import { waitForBucket } from "@/server/files/s3";

console.log(`S3 bucket ${process.env.S3_BUCKET}: ${await waitForBucket()}`);
