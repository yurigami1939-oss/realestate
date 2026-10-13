/**
 * Background worker: `pnpm worker`. Runs separately from Next.js (CLAUDE.md §5 Jobs).
 * Registers one handler per queue and shuts down gracefully on SIGINT/SIGTERM.
 */
import { PgBoss } from "pg-boss";

import { JOBS_SCHEMA } from "@/db/jobs-schema";
import { env } from "@/env";

import { handleCheckOnlinePayment } from "./handlers/check-online-payment";
import { handleExpireOption } from "./handlers/expire-option";
import { handleIssuePaymentCalls } from "./handlers/issue-payment-calls";
import { handleConsoleDaily, handleConsoleDocument, handleConsoleUsage } from "./handlers/console";
import { handleDailyPrivacy, handleRetention } from "./handlers/privacy";
import { handleDailyReminders, handleOverdueDigest } from "./handlers/reminders";
import { handleRenderDocument } from "./handlers/render-document";
import { handleSendPush } from "./handlers/send-push";
import { handleSendEmail } from "./handlers/send-email";
import { handleSendSms } from "./handlers/send-sms";
import { handleSendWhatsapp } from "./handlers/send-whatsapp";

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
await boss.work("reminders.daily", { batchSize: 1 }, handleDailyReminders);
await boss.work("reminders.digest", { batchSize: 1 }, handleOverdueDigest);
await boss.work("online_payment.check", { batchSize: 1 }, handleCheckOnlinePayment);
await boss.work("whatsapp.send", { batchSize: 1 }, handleSendWhatsapp);
await boss.work("sms.send", { batchSize: 1 }, handleSendSms);
await boss.work("push.send", { batchSize: 1 }, handleSendPush);
await boss.work("privacy.daily", { batchSize: 1 }, handleDailyPrivacy);
await boss.work("privacy.retention", { batchSize: 1 }, handleRetention);
await boss.work("console.daily", { batchSize: 1 }, handleConsoleDaily);
await boss.work("console.usage", { batchSize: 1 }, handleConsoleUsage);
await boss.work("console.document", { batchSize: 1 }, handleConsoleDocument);
console.log(
  "[worker] started: email.send, pdf.document, option.expire, payment_call.issue, reminders, online_payment.check, whatsapp.send, sms.send, push.send, privacy, console.daily, console.usage, console.document",
);

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
