import type { Job } from "pg-boss";

import { checkOnlinePayment } from "@/server/online-payments/service";

import type { JobPayloads } from "../queues";

/**
 * `online_payment.check`: asks the gateway about a payment its payer may have left. Throws while
 * the gateway still has it in progress, so pg-boss retries later.
 */
export async function handleCheckOnlinePayment(jobs: Job<JobPayloads["online_payment.check"]>[]) {
  for (const job of jobs) {
    const result = await checkOnlinePayment(job.data.organizationId, job.data.onlinePaymentId);
    console.log(`[worker] online_payment.check ${job.data.onlinePaymentId}: ${result}`);
    if (result === "open") throw new Error("online payment still in progress at the gateway");
  }
}
