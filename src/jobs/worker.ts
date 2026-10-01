/**
 * Background worker: `pnpm worker`. Runs separately from Next.js (CLAUDE.md §5 Jobs).
 * Registers one handler per queue and shuts down gracefully on SIGINT/SIGTERM.
 */
import { PgBoss } from "pg-boss";

import { JOBS_SCHEMA } from "@/db/jobs-schema";
import { env } from "@/env";

import { handleExpireOption } from "./handlers/expire-option";
import { handleIssuePaymentCalls } from "./handlers/issue-payment-calls";
import { handleRenderDocument } from "./handlers/render-document";
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
await boss.work("pdf.document", { batchSize: 1 }, handleRenderDocument);
await boss.work("option.expire", { batchSize: 10 }, handleExpireOption);
await boss.work("payment_call.issue", { batchSize: 1 }, handleIssuePaymentCalls);
console.log("[worker] started: email.send, pdf.document, option.expire, payment_call.issue");

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
