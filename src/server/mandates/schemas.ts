/** Isomorphic: shared by the management mandate forms and their actions. */
import { z } from "zod";

import { MAX_STATEMENT_EXTRAS } from "@/lib/mandates";
import { rentPaymentMethods } from "@/lib/rentals";
import {
  dateText,
  moneyText,
  optionalEmailText,
  optionalText,
  percentText,
  phoneText,
  requiredText,
} from "@/lib/zod";

/** An owner who entrusts the organization with letting its units. */
export const ownerFields = z.object({
  name: requiredText(160),
  nameAr: optionalText(160),
  idNumber: optionalText(40),
  phone: phoneText(),
  email: optionalEmailText(),
  address: optionalText(300),
  bank: optionalText(80),
  rib: optionalText(40),
  notes: optionalText(1000),
});

export const createOwnerSchema = ownerFields;
export const updateOwnerSchema = ownerFields.extend({ ownerId: z.uuid() });

export const createMandateSchema = z.object({
  ownerId: z.uuid(),
  unitId: z.uuid(),
  signedOn: dateText(),
  startOn: dateText(),
  /** Management fees, % of the rents collected. */
  feeRate: percentText(0, 30),
  notes: optionalText(1000),
});

export const endMandateSchema = z.object({
  mandateId: z.uuid(),
  endedOn: dateText(),
  reason: requiredText(300),
});

/** A statement of the rents collected for an owner up to a day, less fees and deductions. */
export const issueOwnerStatementSchema = z.object({
  ownerId: z.uuid(),
  periodTo: dateText(),
  extras: z
    .array(
      z.object({
        label: requiredText(160),
        amount: moneyText().refine((v) => v > 0n, "validation.amount"),
      }),
    )
    .max(MAX_STATEMENT_EXTRAS),
});

export const payOwnerStatementSchema = z
  .object({
    statementId: z.uuid(),
    paidOn: dateText(),
    method: z.enum(rentPaymentMethods),
    reference: optionalText(60),
    /** The cash desk or account it leaves; empty = the method's default account. */
    accountId: z.uuid().or(z.literal("")).optional(),
  })
  .refine((v) => v.method === "cash" || v.reference !== null, {
    path: ["reference"],
    message: "validation.required",
  });

export const cancelOwnerStatementSchema = z.object({
  statementId: z.uuid(),
  reason: requiredText(300),
});

export const ownerStatementIdSchema = z.object({ statementId: z.uuid() });
