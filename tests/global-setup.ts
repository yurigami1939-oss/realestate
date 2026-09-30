import { migrateDatabase } from "@/db/migrate";

import { testEnv } from "./test-env";

/**
 * Once per run: migrates the test database and creates the S3 bucket.
 * Tests isolate themselves by creating their own organizations.
 */
export default async function setup() {
  await migrateDatabase({ ownerUrl: testEnv.DATABASE_OWNER_URL, appUrl: testEnv.DATABASE_URL });

  // The S3 client validates the whole server env at import: load it with the test values.
  Object.assign(process.env, testEnv);
  const { waitForBucket } = await import("@/server/files/s3");
  await waitForBucket();
}
