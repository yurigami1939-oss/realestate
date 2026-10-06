/** Isomorphic: shared by the sales forms (options, reservations, VSP…) and their actions. */
import { z } from "zod";

import { bankLoanStatuses, counterPaymentMethods, MAX_BUYERS_PER_SALE } from "@/lib/sales";
import {
  dateText,
  moneyText,
  optionalDateText,
  optionalMoneyText,
  optionalText,
  percentText,
  requiredText,
} from "@/lib/zod";

// ── Options ─────────────────────────────────────────────────────────────────

export const placeOptionSchema = z.object({ unitId: z.uuid(), leadId: z.uuid() });

export const cancelOptionSchema = z.object({
  optionId: z.uuid(),
  reason: optionalText(300),
});

export const optionIdSchema = z.object({ optionId: z.uuid() });

/** Reason text reused by several sales actions (withdrawal, transfer, swap…). */
export const reasonText = () => requiredText(500);

// ── Reservations & sales ────────────────────────────────────────────────────

/** Main buyer first; co-buyers (spouse…) after. */
const buyerIdsField = () =>
  z
    .array(z.uuid())
    .min(1, "sales.errors.buyerRequired")
    .max(MAX_BUYERS_PER_SALE)
    .refine((ids) => new Set(ids).size === ids.length, "sales.errors.buyerTwice");

export const createReservationSchema = z.object({
  unitId: z.uuid(),
  buyerIds: buyerIdsField(),
  paymentPlanId: z.uuid(),
  /** Only managers may discount (CLAUDE.md §12); "" = none. */
  discount: optionalMoneyText().transform((v) => v ?? 0n),
  /** Day the reservation contract was signed (not in the future). */
  reservedOn: dateText(),
  notary: optionalText(120),
  reference: optionalText(80),
  notes: optionalText(1000),
});

export const reservationIdSchema = z.object({ reservationId: z.uuid() });

/** Notary and reference of the reservation contract. */
export const reservationContractSchema = z.object({
  reservationId: z.uuid(),
  notary: optionalText(120),
  reference: optionalText(80),
  /** Contractual delivery date (Loi 11-04); the indemnity runs past it. */
  deliveryDueOn: optionalDateText(),
  /** FGCMPI guarantee certificate annexed to the VSP. */
  guaranteeNumber: optionalText(60),
  guaranteeIssuedOn: optionalDateText(),
  guaranteePremium: optionalMoneyText(),
});

/** VSP signed at the notary: the unit is sold, the commission earned. */
export const recordSaleSchema = z.object({
  reservationId: z.uuid(),
  signedOn: dateText(),
  notary: requiredText(120),
  reference: optionalText(80),
});

// ── After the reservation ───────────────────────────────────────────────────

/** Désistement proposed with a retention on the amount paid (company default prefilled). */
export const proposeWithdrawalSchema = z.object({
  reservationId: z.uuid(),
  retention: percentText(0, 100),
  reason: reasonText(),
});

/** The gérant approves or rejects a proposed withdrawal. */
export const decideWithdrawalSchema = z.object({
  withdrawalId: z.uuid(),
  approve: z.boolean(),
  note: optionalText(500),
});

/** The refund of an approved withdrawal was paid out. */
export const recordWithdrawalRefundSchema = z.object({
  withdrawalId: z.uuid(),
  refundedOn: dateText(),
  method: z.enum(counterPaymentMethods),
  reference: optionalText(60),
});

/** A line of an amended schedule: due on a date, or at a construction milestone not reached. */
export const amendmentLineFields = z
  .object({
    label: requiredText(120),
    amount: moneyText(),
    dueOn: optionalDateText(),
    milestoneId: z.union([z.uuid(), z.literal("")]),
  })
  .superRefine((line, ctx) => {
    if (line.amount <= 0n) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "sales.errors.amountPositive" });
    }
    if ((line.dueOn === null) === (line.milestoneId === "")) {
      ctx.addIssue({ code: "custom", path: ["dueOn"], message: "sales.errors.dateOrMilestone" });
    }
  })
  .transform((line) => ({
    label: line.label,
    amount: line.amount,
    dueOn: line.milestoneId === "" ? line.dueOn : null,
    milestoneId: line.milestoneId === "" ? null : line.milestoneId,
  }));

/**
 * Avenant: the unpaid part of the schedule replaced by new lines whose total is what remains of
 * the price on those lines (CLAUDE.md §7).
 */
export const rescheduleSaleSchema = z.object({
  reservationId: z.uuid(),
  signedOn: dateText(),
  reason: reasonText(),
  lines: z.array(amendmentLineFields).min(1, "sales.errors.noLines").max(36),
});

/** Cession: new buyers take the reservation over. */
export const transferReservationSchema = z.object({
  reservationId: z.uuid(),
  buyerIds: buyerIdsField(),
  transferredOn: dateText(),
  notes: optionalText(1000),
});

/** Changement de lot within the project, at the new unit's price (managers may discount). */
export const swapUnitSchema = z.object({
  reservationId: z.uuid(),
  unitId: z.uuid(),
  discount: optionalMoneyText().transform((v) => v ?? 0n),
  swappedOn: dateText(),
  reason: reasonText(),
});

const bankLoanFields = {
  bank: requiredText(120),
  requested: moneyText(),
  approved: optionalMoneyText(),
  status: z.enum(bankLoanStatuses),
  submittedOn: optionalDateText(),
  decidedOn: optionalDateText(),
  reference: optionalText(80),
  notes: optionalText(1000),
};
export const createBankLoanSchema = z.object({ reservationId: z.uuid(), ...bankLoanFields });
export const updateBankLoanSchema = z.object({ bankLoanId: z.uuid(), ...bankLoanFields });

/** Documents of a sale whose PDF can be requested again (worker was down…). */
export const saleDocumentKinds = [
  "reservation_sheet",
  "receipt",
  "payment_call",
  "reminder_letter",
  "certificate",
  "schedule_amendment",
] as const;
export const requestSaleDocumentSchema = z.object({
  kind: z.enum(saleDocumentKinds),
  id: z.uuid(),
});

export const SALES_PAGE_SIZE = 25;

export const saleListParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(["reserved", "sold", "withdrawn"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type SaleListParams = z.output<typeof saleListParams>;
