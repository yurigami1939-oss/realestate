/** Isomorphic: a residence's inspections, insurance and maintenance (CLAUDE.md §7). */
import { z } from "zod";

import { checkCategories, checkKinds, checkResults } from "@/lib/maintenance";
import {
  dateText,
  optionalIntText,
  optionalMoneyText,
  optionalText,
  requiredText,
} from "@/lib/zod";

const optionalId = () => z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v));

const checkFields = {
  kind: z.enum(checkKinds),
  category: z.enum(checkCategories),
  title: requiredText(160),
  supplierId: optionalId(),
  /** Months between two visits; blank for a one-off deadline. */
  frequencyMonths: optionalIntText(1, 120),
  nextDueOn: dateText(),
  reference: optionalText(80),
  notes: optionalText(500),
};

export const createCheckSchema = z.object({ residenceId: z.uuid(), ...checkFields });
export const updateCheckSchema = z.object({ checkId: z.uuid(), ...checkFields });
export const checkIdSchema = z.object({ checkId: z.uuid() });

/** A visit done: its day, who did it, the outcome, the cost, and the next deadline. */
export const recordVisitSchema = z.object({
  checkId: z.uuid(),
  doneOn: dateText(),
  supplierId: optionalId(),
  result: z.enum(checkResults),
  notes: optionalText(500),
  cost: optionalMoneyText(),
  nextDueOn: dateText(),
});
