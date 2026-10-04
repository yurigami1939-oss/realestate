"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { deleteInvoice, payInvoice, recordInvoice, updateInvoice } from "./invoices";
import {
  contractIdSchema,
  createInvoiceSchema,
  invoiceIdSchema,
  payInvoiceSchema,
  updateInvoiceSchema,
  createContractSchema,
  createSupplierSchema,
  supplierIdSchema,
  updateContractSchema,
  updateSupplierSchema,
} from "./schemas";
import {
  createContract,
  createSupplier,
  deleteContract,
  deleteSupplier,
  updateContract,
  updateSupplier,
} from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/suppliers", "layout");
    revalidatePath("/[locale]/residences", "layout");
    return result;
  });
}

export const createSupplierAction = defineAction(
  { input: createSupplierSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => createSupplier(ctx, input)),
);
export const updateSupplierAction = defineAction(
  { input: updateSupplierSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => updateSupplier(ctx, input)),
);
export const deleteSupplierAction = defineAction(
  { input: supplierIdSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => deleteSupplier(ctx, input.supplierId)),
);
export const createContractAction = defineAction(
  { input: createContractSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => createContract(ctx, input)),
);
export const updateContractAction = defineAction(
  { input: updateContractSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => updateContract(ctx, input)),
);
export const deleteContractAction = defineAction(
  { input: contractIdSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => deleteContract(ctx, input.contractId)),
);
export const recordInvoiceAction = defineAction(
  { input: createInvoiceSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => recordInvoice(ctx, input)),
);
export const updateInvoiceAction = defineAction(
  { input: updateInvoiceSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => updateInvoice(ctx, input)),
);
export const payInvoiceAction = defineAction(
  { input: payInvoiceSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => payInvoice(ctx, input)),
);
export const deleteInvoiceAction = defineAction(
  { input: invoiceIdSchema, permission: "supplier:update" },
  (input, ctx) => mutation(() => deleteInvoice(ctx, input.invoiceId)),
);
