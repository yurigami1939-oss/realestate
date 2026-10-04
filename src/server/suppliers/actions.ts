"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  contractIdSchema,
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
