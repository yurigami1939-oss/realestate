"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  cancelOwnerStatementSchema,
  createMandateSchema,
  createOwnerSchema,
  endMandateSchema,
  issueOwnerStatementSchema,
  ownerStatementIdSchema,
  payOwnerStatementSchema,
  updateOwnerSchema,
} from "./schemas";
import { createMandate, createOwner, endMandate, updateOwner } from "./service";
import {
  cancelOwnerStatement,
  issueOwnerStatement,
  payOwnerStatement,
  requestOwnerStatementPdf,
} from "./statements";

/** Owners, mandates and statements live under the rentals pages (and feed the ledgers). */
function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/rentals", "layout");
    revalidatePath("/[locale]/treasury", "layout");
    return result;
  });
}

export const createOwnerAction = defineAction(
  { input: createOwnerSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => createOwner(ctx, input)),
);
export const updateOwnerAction = defineAction(
  { input: updateOwnerSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => updateOwner(ctx, input)),
);
export const createMandateAction = defineAction(
  { input: createMandateSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => createMandate(ctx, input)),
);
export const endMandateAction = defineAction(
  { input: endMandateSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => endMandate(ctx, input)),
);
export const issueOwnerStatementAction = defineAction(
  { input: issueOwnerStatementSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => issueOwnerStatement(ctx, input)),
);
export const payOwnerStatementAction = defineAction(
  { input: payOwnerStatementSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => payOwnerStatement(ctx, input)),
);
export const cancelOwnerStatementAction = defineAction(
  { input: cancelOwnerStatementSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => cancelOwnerStatement(ctx, input)),
);
export const requestOwnerStatementPdfAction = defineAction(
  { input: ownerStatementIdSchema, permission: "lease:read" },
  (input, ctx) => mutation(() => requestOwnerStatementPdf(ctx, input.statementId)),
);
