/** Isomorphic: shared by the sales forms (options, reservations, VSP…) and their actions. */
import { z } from "zod";

import { MAX_BUYERS_PER_SALE } from "@/lib/sales";
import { dateText, optionalMoneyText, optionalText, requiredText } from "@/lib/zod";

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

export const createReservationSchema = z.object({
  unitId: z.uuid(),
  /** Main buyer first; co-buyers (spouse…) after. */
  buyerIds: z
    .array(z.uuid())
    .min(1, "sales.errors.buyerRequired")
    .max(MAX_BUYERS_PER_SALE)
    .refine((ids) => new Set(ids).size === ids.length, "sales.errors.buyerTwice"),
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
});

/** VSP signed at the notary: the unit is sold, the commission earned. */
export const recordSaleSchema = z.object({
  reservationId: z.uuid(),
  signedOn: dateText(),
  notary: requiredText(120),
  reference: optionalText(80),
});

/** Documents of a sale whose PDF can be requested again (worker was down…). */
export const saleDocumentKinds = [
  "reservation_sheet",
  "receipt",
  "payment_call",
  "reminder_letter",
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
