"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { cancelQuotationSchema, issueQuotationSchema, quotationIdSchema } from "./schemas";
import { cancelQuotation, issueQuotation, requestQuotationPdf } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/quotations", "layout");
    revalidatePath("/[locale]/leads", "layout");
    return result;
  });
}

export const issueQuotationAction = defineAction(
  { input: issueQuotationSchema, permission: "quotation:create" },
  (input, ctx) => mutation(() => issueQuotation(ctx, input)),
);
export const cancelQuotationAction = defineAction(
  { input: cancelQuotationSchema, permission: "quotation:cancel" },
  (input, ctx) => mutation(() => cancelQuotation(ctx, input)),
);
export const requestQuotationPdfAction = defineAction(
  { input: quotationIdSchema, permission: "lead:read" },
  (input, ctx) => mutation(() => requestQuotationPdf(ctx, input.quotationId)),
);
