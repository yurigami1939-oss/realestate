import type { Job } from "pg-boss";

import { sendPushMessage } from "@/server/push/service";

import type { JobPayloads } from "../queues";

/** `push.send`: one device per job; its push service unreachable → retried by pg-boss. */
export async function handleSendPush(jobs: Job<JobPayloads["push.send"]>[]) {
  for (const job of jobs) {
    const result = await sendPushMessage(job.data, job.retryCount);
    console.log(`[worker] push.send ${job.data.kind} ${job.data.subscriptionId}: ${result}`);
  }
}
