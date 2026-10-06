"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  acceptContractSchema,
  contractIdSchema,
  createContractorSchema,
  createContractSchema,
  createWorksInvoiceSchema,
  payWorksInvoiceSchema,
  releaseRetentionSchema,
  saveBudgetLinesSchema,
  terminateContractSchema,
  updateContractSchema,
  updateWorksInvoiceSchema,
  worksInvoiceIdSchema,
} from "./schemas";
import {
  acceptContract,
  createContract,
  createContractor,
  deleteContract,
  deleteWorksInvoice,
  payWorksInvoice,
  recordWorksInvoice,
  releaseRetention,
  saveBudgetLines,
  terminateContract,
  updateContract,
  updateWorksInvoice,
} from "./service";

const refresh = () => {
  revalidatePath("/[locale]/projects", "layout");
  revalidatePath("/[locale]/treasury", "layout");
};

export const saveBudgetLinesAction = defineAction(
  { input: saveBudgetLinesSchema, permission: "cost:update" },
  async (input, ctx) => {
    await saveBudgetLines(ctx, input);
    refresh();
  },
);

export const createContractorAction = defineAction(
  { input: createContractorSchema, permission: "cost:update" },
  async (input, ctx) => {
    const created = await createContractor(ctx, input);
    refresh();
    return created;
  },
);

export const createContractAction = defineAction(
  { input: createContractSchema, permission: "cost:update" },
  async (input, ctx) => {
    const created = await createContract(ctx, input);
    refresh();
    return created;
  },
);

export const updateContractAction = defineAction(
  { input: updateContractSchema, permission: "cost:update" },
  async (input, ctx) => {
    await updateContract(ctx, input);
    refresh();
  },
);

export const deleteContractAction = defineAction(
  { input: contractIdSchema, permission: "cost:update" },
  async (input, ctx) => {
    await deleteContract(ctx, input);
    refresh();
  },
);

export const acceptContractAction = defineAction(
  { input: acceptContractSchema, permission: "cost:update" },
  async (input, ctx) => {
    await acceptContract(ctx, input);
    refresh();
  },
);

export const terminateContractAction = defineAction(
  { input: terminateContractSchema, permission: "cost:update" },
  async (input, ctx) => {
    await terminateContract(ctx, input);
    refresh();
  },
);

export const releaseRetentionAction = defineAction(
  { input: releaseRetentionSchema, permission: "cost:pay" },
  async (input, ctx) => {
    await releaseRetention(ctx, input);
    refresh();
  },
);

export const recordWorksInvoiceAction = defineAction(
  { input: createWorksInvoiceSchema, permission: "cost:update" },
  async (input, ctx) => {
    const created = await recordWorksInvoice(ctx, input);
    refresh();
    return created;
  },
);

export const updateWorksInvoiceAction = defineAction(
  { input: updateWorksInvoiceSchema, permission: "cost:update" },
  async (input, ctx) => {
    await updateWorksInvoice(ctx, input);
    refresh();
  },
);

export const deleteWorksInvoiceAction = defineAction(
  { input: worksInvoiceIdSchema, permission: "cost:update" },
  async (input, ctx) => {
    await deleteWorksInvoice(ctx, input);
    refresh();
  },
);

export const payWorksInvoiceAction = defineAction(
  { input: payWorksInvoiceSchema, permission: "cost:pay" },
  async (input, ctx) => {
    await payWorksInvoice(ctx, input);
    refresh();
  },
);
