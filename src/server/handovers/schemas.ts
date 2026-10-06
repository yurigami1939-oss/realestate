/** Isomorphic: shared by the delivery forms and their actions. */
import { z } from "zod";

import { punchTrades } from "@/lib/handovers";
import { warrantyKinds } from "@/lib/obligations";
import {
  dateText,
  dateTimeText,
  intText,
  optionalDateText,
  optionalText,
  requiredText,
} from "@/lib/zod";

/** Appointment for the handover of a sold unit (created on first scheduling, then moved). */
export const scheduleHandoverSchema = z.object({
  reservationId: z.uuid(),
  scheduledAt: dateTimeText(),
  notes: optionalText(1000),
});

const punchItemFields = {
  location: requiredText(120),
  description: requiredText(1000),
  trade: z.enum(punchTrades),
  /** Day the promoter commits to lift it by; "" = none. */
  dueOn: optionalDateText(),
};

export const addPunchItemSchema = z.object({ handoverId: z.uuid(), ...punchItemFields });
export const updatePunchItemSchema = z.object({ punchItemId: z.uuid(), ...punchItemFields });
export const punchItemIdSchema = z.object({ punchItemId: z.uuid() });
export const liftPunchItemSchema = z.object({
  punchItemId: z.uuid(),
  liftedOn: dateText(),
  note: optionalText(1000),
});
export const cancelPunchItemSchema = z.object({
  punchItemId: z.uuid(),
  reason: requiredText(500),
});

/** PV de remise des clés. */
export const signHandoverSchema = z.object({
  handoverId: z.uuid(),
  signedOn: dateText(),
  receivedBy: requiredText(200),
  keysCount: intText(0, 50),
  electricityMeter: optionalText(40),
  gasMeter: optionalText(40),
  waterMeter: optionalText(40),
  observations: optionalText(2000),
});

/** PV de levée des réserves. */
export const closeReservesSchema = z.object({ handoverId: z.uuid(), closedOn: dateText() });

/** Units sold and delivered before the app, in a delivered project. */
export const pastDeliveriesSchema = z.object({
  projectId: z.uuid(),
  unitIds: z.array(z.uuid()).min(1, "handovers.errors.noUnit").max(500),
  reason: requiredText(300),
});

/** A delivery document to render again when its PDF is missing. */
export const requestHandoverDocumentSchema = z.object({
  kind: z.enum(["handover_pv", "handover_release"]),
  handoverId: z.uuid(),
});

// ── Warranty claims (after the handover) ────────────────────────────────────

/** A defect reported after the handover: staff from the delivery page, a buyer from the portal. */
export const reportWarrantyClaimSchema = z.object({
  handoverId: z.uuid(),
  location: requiredText(120),
  description: requiredText(1000),
  reportedOn: dateText(),
});
export const portalWarrantyClaimSchema = z.object({
  reservationId: z.uuid(),
  location: requiredText(120),
  description: requiredText(1000),
});

/** Passed to a contractor under a warranty, to fix by a day. */
export const assignWarrantyClaimSchema = z.object({
  claimId: z.uuid(),
  warrantyKind: z.enum(warrantyKinds),
  supplierId: z.uuid(),
  dueOn: dateText(),
  note: optionalText(500),
});

export const fixWarrantyClaimSchema = z.object({
  claimId: z.uuid(),
  fixedOn: dateText(),
  note: optionalText(500),
});

export const rejectWarrantyClaimSchema = z.object({
  claimId: z.uuid(),
  note: requiredText(500),
});
