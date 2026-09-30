import { readFileSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";

import { queueNames, queues } from "@/jobs/queues";

import { JOBS_SCHEMA } from "./jobs-schema";

export const APP_ROLE = "realestate_app";

const migrationsFolder = join(import.meta.dirname, "migrations");
const postMigrateSql = join(import.meta.dirname, "sql", "post-migrate.sql");

/**
 * Brings a database to the current schema:
 * 1. Drizzle SQL migrations (owner role)
 * 2. post-migrate.sql: RLS on tenant tables + grants (owner role)
 * 3. pg-boss schema owned by the app role, installed; queues created/updated (app role)
 */
export async function migrateDatabase(urls: { ownerUrl: string; appUrl: string }): Promise<void> {
  const owner = new Pool({ connectionString: urls.ownerUrl, max: 1 });
  try {
    await migrate(drizzle({ client: owner }), { migrationsFolder });
    await owner.query(readFileSync(postMigrateSql, "utf8"));
    await owner.query(`CREATE SCHEMA IF NOT EXISTS ${JOBS_SCHEMA} AUTHORIZATION ${APP_ROLE}`);
  } finally {
    await owner.end();
  }

  const boss = new PgBoss({
    connectionString: urls.appUrl,
    schema: JOBS_SCHEMA,
    createSchema: false,
    supervise: false,
    schedule: false,
  });
  boss.on("error", (error) => console.error("[pg-boss]", error));
  await boss.start();
  try {
    for (const name of queueNames) {
      if (await boss.getQueue(name)) await boss.updateQueue(name, queues[name]);
      else await boss.createQueue(name, queues[name]);
    }
  } finally {
    await boss.stop({ graceful: false });
  }
}
