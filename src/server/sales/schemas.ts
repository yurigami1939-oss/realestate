/** Isomorphic: shared by the sales forms (options, reservations, VSP…) and their actions. */
import { z } from "zod";

import { optionalText, requiredText } from "@/lib/zod";

// ── Options ─────────────────────────────────────────────────────────────────

export const placeOptionSchema = z.object({ unitId: z.uuid(), leadId: z.uuid() });

export const cancelOptionSchema = z.object({
  optionId: z.uuid(),
  reason: optionalText(300),
});

export const optionIdSchema = z.object({ optionId: z.uuid() });

/** Reason text reused by several sales actions (withdrawal, transfer, swap…). */
export const reasonText = () => requiredText(500);
