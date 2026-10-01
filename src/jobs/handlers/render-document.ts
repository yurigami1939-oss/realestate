import type { Job } from "pg-boss";

import { renderDocument } from "@/server/documents/render";

import type { JobPayloads } from "../queues";

/** `pdf.document`: one document per job; failures are retried by pg-boss. */
export async function handleRenderDocument(jobs: Job<JobPayloads["pdf.document"]>[]) {
  for (const job of jobs) {
    const result = await renderDocument(job.data);
    console.log(`[worker] pdf.document ${job.data.kind} ${job.data.id}: ${result}`);
  }
}
