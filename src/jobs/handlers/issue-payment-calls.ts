import type { Job } from "pg-boss";

import { issueMilestonePaymentCalls } from "@/server/payment-calls/service";

import type { JobPayloads } from "../queues";

/** `payment_call.issue`: issues the calls of a validated milestone (idempotent). */
export async function handleIssuePaymentCalls(jobs: Job<JobPayloads["payment_call.issue"]>[]) {
  for (const job of jobs) {
    const issued = await issueMilestonePaymentCalls(job.data.organizationId, job.data.milestoneId);
    console.log(`[worker] payment_call.issue ${job.data.milestoneId}: ${issued} issued`);
  }
}
