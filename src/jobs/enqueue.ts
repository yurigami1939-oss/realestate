import "server-only";

import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss, type SendOptions } from "pg-boss";

import type { Tx } from "@/db/client";
import { JOBS_SCHEMA } from "@/db/jobs-schema";
import { env } from "@/env";

import type { JobPayloads, QueueName } from "./queues";

const globalForBoss = globalThis as unknown as { bossSender?: Promise<PgBoss> };

/** Send-only pg-boss instance for request handlers: no workers, no maintenance, no cron. */
function sender(): Promise<PgBoss> {
  globalForBoss.bossSender ??= (async () => {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: JOBS_SCHEMA,
      max: 2,
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    boss.on("error", (error) => console.error("[pg-boss sender]", error));
    return boss.start();
  })();
  return globalForBoss.bossSender;
}

/** Enqueues a job; the worker process (`pnpm worker`) runs it. Returns the job id. */
export async function enqueue<Q extends QueueName>(
  queue: Q,
  data: JobPayloads[Q],
  options: SendOptions = {},
): Promise<string | null> {
  const boss = await sender();
  return boss.send(queue, data, options);
}

/**
 * Enqueues through the caller's transaction: the job exists only if the business change
 * commits (e.g. render a document right after issuing it). Returns the job id.
 */
export async function enqueueInTx<Q extends QueueName>(
  tx: Tx,
  queue: Q,
  data: JobPayloads[Q],
  options: SendOptions = {},
): Promise<string | null> {
  const boss = await sender();
  return boss.send(queue, data, { ...options, db: fromDrizzle(tx, sql) });
}

/** Closes the sender's connections (tests, scripts). */
export async function stopEnqueue(): Promise<void> {
  const pending = globalForBoss.bossSender;
  globalForBoss.bossSender = undefined;
  if (pending) await (await pending).stop({ graceful: false });
}
