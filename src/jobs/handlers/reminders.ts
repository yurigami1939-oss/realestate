import type { Job } from "pg-boss";

import { queueOverdueDigests, sendOverdueDigest } from "@/server/collections/service";

import type { JobPayloads } from "../queues";

/** `reminders.daily` (cron 08:00 Algiers): one digest job per organization. */
export async function handleDailyReminders(jobs: Job<JobPayloads["reminders.daily"]>[]) {
  for (const job of jobs) {
    const organizations = await queueOverdueDigests();
    console.log(`[worker] reminders.daily ${job.id}: ${organizations} organizations`);
  }
}

/** `reminders.digest`: e-mails an organization's overdue sales to its cashiers and managers. */
export async function handleOverdueDigest(jobs: Job<JobPayloads["reminders.digest"]>[]) {
  for (const job of jobs) {
    const sent = await sendOverdueDigest(job.data.organizationId, job.data.date);
    console.log(`[worker] reminders.digest ${job.data.organizationId}: ${sent} e-mails`);
  }
}
