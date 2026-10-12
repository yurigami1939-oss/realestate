import { Pool } from "pg";

import { JOBS_SCHEMA } from "./jobs-schema";
import { migrateDatabase } from "./migrate";

/**
 * Drops every schema object (tables, the jobs schema, the migrations journal) and migrates from
 * scratch. Callers check the database first (`assertLocalDatabase`), then seed.
 */
export async function rebuildDatabase(urls: { ownerUrl: string; appUrl: string }): Promise<void> {
  const owner = new Pool({ connectionString: urls.ownerUrl, max: 1 });
  try {
    await owner.query(`
      DROP SCHEMA IF EXISTS ${JOBS_SCHEMA} CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS console CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      DROP TYPE IF EXISTS document_type;
      CREATE SCHEMA public;
    `);
  } finally {
    await owner.end();
  }
  await migrateDatabase(urls);
}
