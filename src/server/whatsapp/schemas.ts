/** Isomorphic: shared by the WhatsApp settings form, the message log and their actions. */
import { z } from "zod";

import { whatsappKinds, whatsappLanguages, whatsappStatuses } from "@/lib/whatsapp";
import { optionalText, requiredText } from "@/lib/zod";

const templateName = z
  .string()
  .trim()
  .max(512)
  .regex(/^[a-z0-9_]*$/, "whatsapp.errors.templateName");

/**
 * The organization's WhatsApp Business number (Cloud API). Empty secrets keep the saved ones;
 * each notification is switched on once its template is approved by Meta.
 */
export const whatsappSettingsSchema = z.object({
  enabled: z.boolean(),
  phoneNumberId: requiredText(40).regex(/^\d+$/, "whatsapp.errors.numericId"),
  businessAccountId: optionalText(40),
  accessToken: z.string().trim().max(1000),
  appSecret: z.string().trim().max(200),
  language: z.enum(whatsappLanguages),
  notifications: z.array(
    z.object({ kind: z.enum(whatsappKinds), enabled: z.boolean(), template: templateName }),
  ),
});

/** Filters of the message log (URL search params). */
export const whatsappLogParams = z.object({
  status: z.enum(whatsappStatuses).optional().catch(undefined),
  kind: z.enum(whatsappKinds).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type WhatsappLogParams = z.output<typeof whatsappLogParams>;

/** Consent of a co-owner or occupant, recorded by the gestionnaire. */
export const residentWhatsappSchema = z.object({ residentId: z.uuid(), optIn: z.boolean() });
