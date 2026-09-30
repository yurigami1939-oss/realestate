import type { Job } from "pg-boss";

import { renderAndStoreQuotationPdf } from "@/server/quotations/pdf";

import type { JobPayloads } from "../queues";

/** `pdf.quotation`: one quotation per job; failures are retried by pg-boss. */
export async function handleRenderQuotationPdf(jobs: Job<JobPayloads["pdf.quotation"]>[]) {
  for (const job of jobs) {
    const result = await renderAndStoreQuotationPdf(job.data);
    console.log(`[worker] pdf.quotation ${job.data.quotationId}: ${result}`);
  }
}
