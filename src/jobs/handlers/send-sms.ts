import type { Job } from "pg-boss";

import { sendSmsMessage } from "@/server/sms/service";

import type { JobPayloads } from "../queues";

/** `sms.send`: one message per job; the gateway unreachable or throttling → retried by pg-boss. */
export async function handleSendSms(jobs: Job<JobPayloads["sms.send"]>[]) {
  for (const job of jobs) {
    const result = await sendSmsMessage(
      job.data.organizationId,
      job.data.messageId,
      job.retryCount,
    );
    console.log(`[worker] sms.send ${job.data.messageId}: ${result}`);
  }
}
