/** Isomorphic: shared by the SMS settings form, the message log and their actions. */
import { z } from "zod";

import { SMS_SENDER_PATTERN, smsProviders, smsStatuses } from "@/lib/sms";
import { whatsappKinds, whatsappLanguages } from "@/lib/whatsapp";
import { optionalText, phoneText } from "@/lib/zod";

/**
 * The organization's SMS account: its provider, the gateway's URL (blank: the local stand-in in
 * development), the sender name registered with the operator, the API key (blank keeps the
 * saved one), the language of the texts and the notifications sent by SMS.
 */
export const smsSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(smsProviders),
  apiUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || /^https?:\/\/\S+$/.test(v), "sms.errors.url"),
  sender: z.string().trim().regex(SMS_SENDER_PATTERN, "sms.errors.sender"),
  apiKey: z.string().trim().max(500),
  language: z.enum(whatsappLanguages),
  kinds: z.array(z.enum(whatsappKinds)).max(whatsappKinds.length),
});

/** A test message to one number, from the settings page. */
export const testSmsSchema = z.object({ phone: phoneText() });

/** A number that asked for no more SMS (« STOP »), or its removal. */
export const smsOptOutSchema = z.object({ phone: phoneText(), reason: optionalText(200) });
export const removeSmsOptOutSchema = z.object({ optOutId: z.uuid() });

/** Filters of the SMS log (URL search params). */
export const smsLogParams = z.object({
  status: z.enum(smsStatuses).optional().catch(undefined),
  kind: z.enum(whatsappKinds).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type SmsLogParams = z.output<typeof smsLogParams>;
