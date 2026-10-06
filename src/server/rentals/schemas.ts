/** Isomorphic: shared by the rental forms and their actions. */
import { z } from "zod";

import {
  inspectionConditions,
  inspectionKinds,
  leaseKinds,
  MAX_LEASE_MONTHS,
  rentFrequencies,
  rentPaymentKinds,
  rentPaymentMethods,
} from "@/lib/rentals";
import {
  dateText,
  intText,
  moneyText,
  optionalEmailText,
  optionalIntText,
  optionalMoneyText,
  optionalText,
  phoneText,
  requiredText,
} from "@/lib/zod";

/** Rent, charges, frequency and deposit of a lease (or of its renewal). */
const termsFields = {
  signedOn: dateText(),
  durationMonths: intText(1, MAX_LEASE_MONTHS),
  /** Monthly rent, DA. */
  monthlyRent: moneyText().refine((v) => v > 0n, "validation.amount"),
  /** Monthly provision for charges billed to the tenant, DA; "" = none. */
  monthlyCharges: optionalMoneyText(),
  frequency: z.enum(rentFrequencies),
  /** Dépôt de garantie, DA; "" = none. */
  deposit: optionalMoneyText(),
  notes: optionalText(2000),
};

const tenantFields = {
  kind: z.enum(leaseKinds),
  /** A person (« Nom Prénom ») or a company. */
  tenantName: requiredText(160),
  tenantNameAr: optionalText(160),
  /** NIN of a person, RC number of a company. */
  tenantIdNumber: optionalText(40),
  tenantPhone: phoneText(),
  /** The tenant's consent to WhatsApp notifications (quittances). */
  tenantWhatsappOptIn: z.boolean().default(false),
  tenantEmail: optionalEmailText(),
  tenantAddress: optionalText(300),
  /** Trade carried on in a commercial unit. */
  activity: optionalText(160),
};

export const createLeaseSchema = z.object({
  unitId: z.uuid(),
  ...tenantFields,
  ...termsFields,
  startOn: dateText(),
});

/** Tenant details always; the terms only while no payment is recorded. */
export const updateLeaseSchema = z.object({
  leaseId: z.uuid(),
  ...tenantFields,
  ...termsFields,
  startOn: dateText(),
});

/** The tenant leaves (or the lease is cancelled): the unit is available again. */
export const endLeaseSchema = z.object({
  leaseId: z.uuid(),
  endedOn: dateText(),
  reason: requiredText(300),
});

/** A new lease for the same tenant from the day after the current one's term. */
export const renewLeaseSchema = z.object({ leaseId: z.uuid(), ...termsFields });

export const recordRentPaymentSchema = z
  .object({
    leaseId: z.uuid(),
    kind: z.enum(rentPaymentKinds),
    amount: moneyText().refine((v) => v > 0n, "validation.amount"),
    method: z.enum(rentPaymentMethods),
    /** Day the money or cheque was received (not in the future). */
    paidOn: dateText(),
    reference: optionalText(60),
    bank: optionalText(80),
    payerName: requiredText(160),
    notes: optionalText(500),
    /** The cash desk or account it lands on; empty = the method's default account. */
    accountId: z.uuid().or(z.literal("")).optional(),
  })
  .refine((v) => v.method !== "cheque" || (v.reference !== null && v.bank !== null), {
    path: ["reference"],
    message: "payments.errors.chequeDetails",
  });

export const cancelRentPaymentSchema = z.object({
  paymentId: z.uuid(),
  reason: requiredText(300),
});

export const clearRentChequeSchema = z.object({
  paymentId: z.uuid(),
  clearedOn: dateText(),
});

/** What is given back of the deposit when the tenant leaves; the rest is kept, with the reason. */
export const settleDepositSchema = z.object({
  leaseId: z.uuid(),
  settledOn: dateText(),
  refunded: optionalMoneyText(),
  reason: optionalText(500),
});

export const leaseIdSchema = z.object({ leaseId: z.uuid() });
export const rentReceiptIdSchema = z.object({ paymentId: z.uuid() });

/** One element of an état des lieux: its condition and remarks. */
export const inspectionItemSchema = z.object({
  element: requiredText(80),
  condition: z.enum(inspectionConditions),
  notes: optionalText(300),
});

/** État des lieux d'entrée ou de sortie (one of each per lease, final). */
export const recordInspectionSchema = z.object({
  leaseId: z.uuid(),
  kind: z.enum(inspectionKinds),
  inspectedOn: dateText(),
  items: z.array(inspectionItemSchema).min(1, "rentals.errors.noItems").max(40),
  electricityMeter: optionalText(40),
  gasMeter: optionalText(40),
  waterMeter: optionalText(40),
  keysCount: optionalIntText(0, 50),
  observations: optionalText(2000),
});

export const inspectionIdSchema = z.object({ inspectionId: z.uuid() });
