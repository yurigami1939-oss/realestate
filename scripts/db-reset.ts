/** `pnpm db:reset`: drops every schema object, migrates from scratch and seeds (local only). */
import { pool } from "@/db/client";
import { consolePool } from "@/db/console-client";
import { rebuildDatabase } from "@/db/reset";
import { assertLocalDatabase, seedDemo } from "@/db/seed";
import { stopEnqueue } from "@/jobs/enqueue";

const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error("DATABASE_OWNER_URL and DATABASE_URL are required");
assertLocalDatabase(appUrl);

await rebuildDatabase({ ownerUrl, appUrl });
await seedDemo();
// Seeding enqueues jobs (document PDFs): close the pg-boss sender too.
await stopEnqueue();
await pool.end();
await consolePool.end();
console.log("Database reset, migrated and seeded.");
