"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { rescheduleSale } from "./amendments";
import { createBankLoan, updateBankLoan } from "./bank-loans";
import { swapUnit, transferReservation } from "./changes";
import { saveSaleFinancing } from "./financing";
import { requestSaleDocument } from "./document-requests";
import { cancelOption, placeOption } from "./options";
import { createReservation, recordSale, updateReservationContract } from "./reservations";
import {
  cancelOptionSchema,
  createBankLoanSchema,
  createReservationSchema,
  decideWithdrawalSchema,
  placeOptionSchema,
  proposeWithdrawalSchema,
  recordSaleSchema,
  recordWithdrawalRefundSchema,
  requestSaleDocumentSchema,
  rescheduleSaleSchema,
  saveSaleFinancingSchema,
  reservationContractSchema,
  swapUnitSchema,
  transferReservationSchema,
  updateBankLoanSchema,
} from "./schemas";
import { decideWithdrawal, proposeWithdrawal, recordWithdrawalRefund } from "./withdrawals";

/** Sales touch units, leads, buyers and sales pages. */
function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    for (const path of [
      "/[locale]/projects",
      "/[locale]/leads",
      "/[locale]/buyers",
      "/[locale]/sales",
    ]) {
      revalidatePath(path, "layout");
    }
    return result;
  });
}

export const placeOptionAction = defineAction(
  { input: placeOptionSchema, permission: "sale:create" },
  (input, ctx) => mutation(() => placeOption(ctx, input)),
);
export const cancelOptionAction = defineAction(
  { input: cancelOptionSchema, permission: "sale:create" },
  (input, ctx) => mutation(() => cancelOption(ctx, input)),
);
export const createReservationAction = defineAction(
  { input: createReservationSchema, permission: "sale:create" },
  (input, ctx) => mutation(() => createReservation(ctx, input)),
);
export const updateReservationContractAction = defineAction(
  { input: reservationContractSchema, permission: "sale:update" },
  (input, ctx) => mutation(() => updateReservationContract(ctx, input)),
);
export const rescheduleSaleAction = defineAction(
  { input: rescheduleSaleSchema, permission: "sale:update" },
  (input, ctx) => mutation(() => rescheduleSale(ctx, input)),
);
export const recordSaleAction = defineAction(
  { input: recordSaleSchema, permission: "sale:sign" },
  (input, ctx) => mutation(() => recordSale(ctx, input)),
);
export const requestSaleDocumentAction = defineAction(
  { input: requestSaleDocumentSchema, permission: "sale:read" },
  (input, ctx) => mutation(() => requestSaleDocument(ctx, input)),
);
export const proposeWithdrawalAction = defineAction(
  { input: proposeWithdrawalSchema, permission: "sale:withdraw" },
  (input, ctx) => mutation(() => proposeWithdrawal(ctx, input)),
);
export const decideWithdrawalAction = defineAction(
  { input: decideWithdrawalSchema, permission: "sale:approve" },
  (input, ctx) => mutation(() => decideWithdrawal(ctx, input)),
);
export const recordWithdrawalRefundAction = defineAction(
  { input: recordWithdrawalRefundSchema, permission: "payment:create" },
  (input, ctx) => mutation(() => recordWithdrawalRefund(ctx, input)),
);
export const transferReservationAction = defineAction(
  { input: transferReservationSchema, permission: "sale:update" },
  (input, ctx) => mutation(() => transferReservation(ctx, input)),
);
export const swapUnitAction = defineAction(
  { input: swapUnitSchema, permission: "sale:update" },
  (input, ctx) => mutation(() => swapUnit(ctx, input)),
);
export const createBankLoanAction = defineAction(
  { input: createBankLoanSchema, permission: "sale:update" },
  (input, ctx) => mutation(() => createBankLoan(ctx, input)),
);
export const saveSaleFinancingAction = defineAction(
  { input: saveSaleFinancingSchema, permission: "sale:finance" },
  (input, ctx) => mutation(() => saveSaleFinancing(ctx, input)),
);
export const updateBankLoanAction = defineAction(
  { input: updateBankLoanSchema, permission: "sale:update" },
  (input, ctx) => mutation(() => updateBankLoan(ctx, input)),
);
