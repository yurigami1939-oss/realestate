/** Isomorphic: the costs of a project (CLAUDE.md §7 Construction costs). */
import { z } from "zod";

import { costCategories, costPaymentMethods } from "@/lib/costs";
import {
  dateText,
  moneyText,
  optionalDateText,
  optionalText,
  percentText,
  requiredText,
} from "@/lib/zod";

/** The project's budget, saved as a whole (bilan prévisionnel). */
export const saveBudgetLinesSchema = z.object({
  projectId: z.uuid(),
  lines: z
    .array(
      z.object({
        category: z.enum(costCategories),
        label: requiredText(160),
        amount: moneyText().refine((v) => v >= 0n, "validation.amount"),
      }),
    )
    .max(100),
});

/** A contractor or design office not known yet (kept with the organization's suppliers). */
export const createContractorSchema = z.object({
  name: requiredText(120),
  activity: optionalText(120),
  nif: optionalText(30),
  rib: optionalText(40),
});

const contractFields = {
  supplierId: z.uuid(),
  category: z.enum(costCategories),
  reference: optionalText(60),
  title: requiredText(160),
  amount: moneyText().refine((v) => v > 0n, "validation.amount"),
  /** Retention of guarantee, % of each progress invoice (5 % by default). */
  retention: percentText(0, 10),
  signedOn: dateText(),
  plannedEndOn: optionalDateText(),
  notes: optionalText(1000),
};

export const createContractSchema = z.object({ projectId: z.uuid(), ...contractFields });
export const updateContractSchema = z.object({ contractId: z.uuid(), ...contractFields });
export const contractIdSchema = z.object({ contractId: z.uuid() });
/** The contract dialog's form: `targetId` is the project (new) or the contract (edit). */
export const contractFormSchema = z.object({ targetId: z.uuid(), ...contractFields });

/** Réception provisoire, then définitive (the retention becomes payable). */
export const acceptContractSchema = z.object({
  contractId: z.uuid(),
  stage: z.enum(["provisional", "final"]),
  acceptedOn: dateText(),
  notes: optionalText(1000),
});

/** Résiliation of a contract (what is invoiced stays). */
export const terminateContractSchema = z.object({
  contractId: z.uuid(),
  terminatedOn: dateText(),
  reason: requiredText(500),
});

/** The retention paid back after the réception définitive. */
export const releaseRetentionSchema = z.object({
  contractId: z.uuid(),
  paidOn: dateText(),
  method: z.enum(costPaymentMethods),
  reference: optionalText(60),
  accountId: z.uuid().or(z.literal("")).optional(),
});

const invoiceFields = {
  number: optionalText(60),
  invoicedOn: dateText(),
  dueOn: optionalDateText(),
  label: optionalText(160),
  gross: moneyText().refine((v) => v > 0n, "validation.amount"),
};

/** A progress invoice (situation de travaux): the retention follows the contract's rate. */
export const createWorksInvoiceSchema = z.object({ contractId: z.uuid(), ...invoiceFields });
export const updateWorksInvoiceSchema = z.object({ invoiceId: z.uuid(), ...invoiceFields });
export const worksInvoiceIdSchema = z.object({ invoiceId: z.uuid() });
/** The progress invoice dialog's form: `targetId` is the contract (new) or the invoice (edit). */
export const worksInvoiceFormSchema = z.object({ targetId: z.uuid(), ...invoiceFields });

/** Paying a progress invoice's net amount from an account. */
export const payWorksInvoiceSchema = z.object({
  invoiceId: z.uuid(),
  paidOn: dateText(),
  method: z.enum(costPaymentMethods),
  reference: optionalText(60),
  accountId: z.uuid().or(z.literal("")).optional(),
});
