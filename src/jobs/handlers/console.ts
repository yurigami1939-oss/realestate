import type { Job } from "pg-boss";

import { renderConsoleDocument } from "@/server/console/billing-documents";
import { runConsoleDaily } from "@/server/console/lifecycle";
import { runUsageSnapshot } from "@/server/console/usage";

import type { JobPayloads } from "../queues";

/** `console.daily` (cron 06:30 Algiers): the subscriptions' automatic states and warnings. */
export async function handleConsoleDaily(jobs: Job<JobPayloads["console.daily"]>[]) {
  for (const job of jobs) {
    const { pastDue, reactivated, warned } = await runConsoleDaily();
    console.log(
      `[worker] console.daily ${job.id}: ${pastDue} pilots over, ${reactivated} active again, ${warned} e-mails`,
    );
  }
}

/** `console.usage` (cron 02:00 Algiers): every organization's usage snapshot, old ones pruned. */
export async function handleConsoleUsage(jobs: Job<JobPayloads["console.usage"]>[]) {
  for (const job of jobs) {
    const organizations = await runUsageSnapshot();
    console.log(`[worker] console.usage ${job.id}: ${organizations} organizations measured`);
  }
}

/** `console.document`: an operator invoice or credit note rendered once, stored, e-mailed. */
export async function handleConsoleDocument(jobs: Job<JobPayloads["console.document"]>[]) {
  for (const job of jobs) {
    const outcome = await renderConsoleDocument(job.data.kind, job.data.id);
    console.log(`[worker] console.document ${job.data.kind} ${job.data.id}: ${outcome}`);
  }
}
