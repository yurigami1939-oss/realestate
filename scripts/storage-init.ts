/** Creates the S3 bucket once the storage container accepts requests. Run by `pnpm docker:up`. */
import { ensureBucket } from "@/server/files/s3";

const deadline = Date.now() + 30_000;

for (;;) {
  try {
    const result = await ensureBucket();
    console.log(`S3 bucket ${process.env.S3_BUCKET}: ${result}`);
    break;
  } catch (error) {
    if (Date.now() > deadline) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
