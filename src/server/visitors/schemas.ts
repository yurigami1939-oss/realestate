/** Isomorphic: shared by the visitors' forms and actions. */
import { z } from "zod";

import { dateText, optionalIntText, optionalText, requiredText } from "@/lib/zod";

/** A visitor announced from the portal for a day, at one of the account's units. */
export const announceVisitorSchema = z.object({
  unitId: z.uuid(),
  visitorName: requiredText(120),
  expectedOn: dateText(),
  people: optionalIntText(1, 50).transform((v) => v ?? 1),
  note: optionalText(300),
});

/** A visitor who came unannounced, logged by staff as arrived. */
export const logVisitorSchema = z.object({
  residenceId: z.uuid(),
  unitId: z
    .uuid()
    .or(z.literal(""))
    .transform((v) => v || null),
  hostName: requiredText(120),
  visitorName: requiredText(120),
  people: optionalIntText(1, 50).transform((v) => v ?? 1),
  note: optionalText(300),
});

export const visitorPassIdSchema = z.object({ passId: z.uuid() });
