import type { Job } from "pg-boss";

import { expireOption } from "@/server/sales/options";

import type { JobPayloads } from "../queues";

/** `option.expire`: releases the unit if the option is still active and past its expiry. */
export async function handleExpireOption(jobs: Job<JobPayloads["option.expire"]>[]) {
  for (const job of jobs) {
    const result = await expireOption(job.data);
    console.log(`[worker] option.expire ${job.data.optionId}: ${result}`);
  }
}
