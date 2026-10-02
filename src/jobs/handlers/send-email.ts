import "server-only";

import type { Job } from "pg-boss";

import { sendEmailNow } from "@/server/email/transport";

import type { JobPayloads } from "../queues";

export async function handleSendEmail(jobs: Job<JobPayloads["email.send"]>[]): Promise<void> {
  for (const job of jobs) {
    await sendEmailNow(job.data);
  }
}
