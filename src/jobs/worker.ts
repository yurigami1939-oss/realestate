/**
 * Background worker: `pnpm worker`. Runs separately from Next.js (CLAUDE.md §5 Jobs).
 * Registers one handler per queue and shuts down gracefully on SIGINT/SIGTERM.
 */
import { PgBoss } from "pg-boss";

import { JOBS_SCHEMA } from "@/db/jobs-schema";
import { env } from "@/env";

import { handleRenderQuotationPdf } from "./handlers/render-quotation-pdf";
import { handleSendEmail } from "./handlers/send-email";

const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  schema: JOBS_SCHEMA,
  migrate: false,
  createSchema: false,
});

boss.on("error", (error) => console.error("[worker]", error));

await boss.start();
await boss.work("email.send", { batchSize: 5 }, handleSendEmail);
await boss.work("pdf.quotation", { batchSize: 1 }, handleRenderQuotationPdf);
console.log("[worker] started: email.send, pdf.quotation");

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal}: finishing active jobs…`);
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
