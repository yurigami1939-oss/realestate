import type { Job } from "pg-boss";

import { sendWhatsappMessage } from "@/server/whatsapp/service";

import type { JobPayloads } from "../queues";

/** `whatsapp.send`: one message per job; Meta unreachable or throttling → retried by pg-boss. */
export async function handleSendWhatsapp(jobs: Job<JobPayloads["whatsapp.send"]>[]) {
  for (const job of jobs) {
    const result = await sendWhatsappMessage(
      job.data.organizationId,
      job.data.messageId,
      job.retryCount,
    );
    console.log(`[worker] whatsapp.send ${job.data.messageId}: ${result}`);
  }
}
