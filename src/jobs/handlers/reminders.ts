import type { Job } from "pg-boss";

import { sendChargesDigest } from "@/server/charges/collections";
import { queueOverdueDigests, sendOverdueDigest } from "@/server/collections/service";
import { tenantWritable } from "@/server/entitlements/access";
import { sendRentsDigest } from "@/server/rentals/digest";

import type { JobPayloads } from "../queues";

/** `reminders.daily` (cron 08:00 Algiers): one digest job per organization. */
export async function handleDailyReminders(jobs: Job<JobPayloads["reminders.daily"]>[]) {
  for (const job of jobs) {
    const organizations = await queueOverdueDigests();
    console.log(`[worker] reminders.daily ${job.id}: ${organizations} organizations`);
  }
}

/**
 * `reminders.digest`: e-mails an organization's overdue sales to its cashiers and sales
 * managers, its overdue charges to its property managers and cashiers, and its overdue rents
 * and leases ending soon to the same.
 */
export async function handleOverdueDigest(jobs: Job<JobPayloads["reminders.digest"]>[]) {
  for (const job of jobs) {
    // A read-only organization (suspended, terminated) gets no digest (CLAUDE.console.md §6).
    if (!(await tenantWritable(job.data.organizationId))) continue;
    const sales = await sendOverdueDigest(job.data.organizationId, job.data.date);
    const charges = await sendChargesDigest(job.data.organizationId, job.data.date);
    const rents = await sendRentsDigest(job.data.organizationId, job.data.date);
    console.log(
      `[worker] reminders.digest ${job.data.organizationId}: ${sales} + ${charges} + ${rents} e-mails`,
    );
  }
}
