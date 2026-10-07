"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  cancelRentPaymentSchema,
  clearRentChequeSchema,
  createLeaseSchema,
  endLeaseSchema,
  inspectionIdSchema,
  recordInspectionSchema,
  recordRentPaymentSchema,
  renewLeaseSchema,
  rentReceiptIdSchema,
  reviseRentSchema,
  settleDepositSchema,
  updateLeaseSchema,
} from "./schemas";
import {
  cancelRentPayment,
  clearRentCheque,
  createLease,
  endLease,
  recordInspection,
  recordRentPayment,
  renewLease,
  requestInspectionReport,
  requestRentReceipt,
  reviseRent,
  settleDeposit,
  updateLease,
} from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidatePath("/[locale]/rentals", "layout");
    return result;
  });
}

/** Leases change the unit's status (inventory) and the residence's occupants. */
function leaseMutation<T>(run: () => Promise<T>): Promise<T> {
  return mutation(run).then((result) => {
    revalidatePath("/[locale]/projects", "layout");
    revalidatePath("/[locale]/residences", "layout");
    return result;
  });
}

export const createLeaseAction = defineAction(
  { input: createLeaseSchema, permission: "lease:update" },
  (input, ctx) => leaseMutation(() => createLease(ctx, input)),
);
export const updateLeaseAction = defineAction(
  { input: updateLeaseSchema, permission: "lease:update" },
  (input, ctx) => leaseMutation(() => updateLease(ctx, input)),
);
export const endLeaseAction = defineAction(
  { input: endLeaseSchema, permission: "lease:update" },
  (input, ctx) => leaseMutation(() => endLease(ctx, input)),
);
export const renewLeaseAction = defineAction(
  { input: renewLeaseSchema, permission: "lease:update" },
  (input, ctx) => leaseMutation(() => renewLease(ctx, input)),
);
export const reviseRentAction = defineAction(
  { input: reviseRentSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => reviseRent(ctx, input)),
);
export const settleDepositAction = defineAction(
  { input: settleDepositSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => settleDeposit(ctx, input)),
);
export const recordRentPaymentAction = defineAction(
  { input: recordRentPaymentSchema, permission: "payment:create" },
  (input, ctx) => mutation(() => recordRentPayment(ctx, input)),
);
export const cancelRentPaymentAction = defineAction(
  { input: cancelRentPaymentSchema, permission: "payment:cancel" },
  (input, ctx) => mutation(() => cancelRentPayment(ctx, input)),
);
export const clearRentChequeAction = defineAction(
  { input: clearRentChequeSchema, permission: "payment:create" },
  (input, ctx) => mutation(() => clearRentCheque(ctx, input)),
);
export const recordInspectionAction = defineAction(
  { input: recordInspectionSchema, permission: "lease:update" },
  (input, ctx) => mutation(() => recordInspection(ctx, input)),
);
export const requestInspectionReportAction = defineAction(
  { input: inspectionIdSchema, permission: "lease:read" },
  (input, ctx) => requestInspectionReport(ctx, input.inspectionId),
);
export const requestRentReceiptAction = defineAction(
  { input: rentReceiptIdSchema, permission: "lease:read" },
  (input, ctx) => requestRentReceipt(ctx, input.paymentId),
);
