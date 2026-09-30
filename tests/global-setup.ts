import { migrateDatabase } from "@/db/migrate";

import { testEnv } from "./test-env";

/** Migrates the test database once per run. Tests isolate themselves by creating their own organizations. */
export default async function setup() {
  await migrateDatabase({ ownerUrl: testEnv.DATABASE_OWNER_URL, appUrl: testEnv.DATABASE_URL });
}
