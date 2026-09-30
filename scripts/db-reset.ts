/** `pnpm db:reset`: drops every schema object, migrates from scratch and seeds (local only). */
import { Pool } from "pg";

import { pool } from "@/db/client";
import { stopEnqueue } from "@/jobs/enqueue";
import { JOBS_SCHEMA } from "@/db/jobs-schema";
import { migrateDatabase } from "@/db/migrate";
import { assertLocalDatabase, seedDemo } from "@/db/seed";

const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error("DATABASE_OWNER_URL and DATABASE_URL are required");
assertLocalDatabase(appUrl);

const owner = new Pool({ connectionString: ownerUrl, max: 1 });
try {
  await owner.query(`
    DROP SCHEMA IF EXISTS ${JOBS_SCHEMA} CASCADE;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA IF EXISTS public CASCADE;
    DROP TYPE IF EXISTS document_type;
    CREATE SCHEMA public;
  `);
} finally {
  await owner.end();
}

await migrateDatabase({ ownerUrl, appUrl });
await seedDemo();
// Seeding enqueues jobs (document PDFs): close the pg-boss sender too.
await stopEnqueue();
await pool.end();
console.log("Database reset, migrated and seeded.");
