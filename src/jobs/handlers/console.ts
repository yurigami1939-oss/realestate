import type { Job } from "pg-boss";

import { runConsoleDaily } from "@/server/console/lifecycle";

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
