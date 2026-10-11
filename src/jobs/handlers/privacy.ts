import type { Job } from "pg-boss";

import { applyRetention, queueRetentionJobs } from "@/server/privacy/retention";

import type { JobPayloads } from "../queues";

/** `privacy.daily` (cron 03:00 Algiers): one retention job per organization. */
export async function handleDailyPrivacy(jobs: Job<JobPayloads["privacy.daily"]>[]) {
  for (const job of jobs) {
    const organizations = await queueRetentionJobs();
    console.log(`[worker] privacy.daily ${job.id}: ${organizations} organizations`);
  }
}

/** `privacy.retention`: anonymizes the prospects and erases the messages past their periods. */
export async function handleRetention(jobs: Job<JobPayloads["privacy.retention"]>[]) {
  for (const job of jobs) {
    const { leads, messages } = await applyRetention(job.data.organizationId, job.data.date);
    console.log(
      `[worker] privacy.retention ${job.data.organizationId}: ${leads} prospects, ${messages} messages`,
    );
  }
}
