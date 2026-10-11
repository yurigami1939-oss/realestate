import { z } from "zod";

import { locales } from "@/i18n/locales";

const base64url = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+={0,2}$/, "push.errors.keys");

/** What the browser's `PushSubscription.toJSON()` gives, with the language of the page. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().trim().min(1).max(2048),
  keys: z.object({ p256dh: base64url.max(100), auth: base64url.max(40) }),
  locale: z.enum(locales),
  userAgent: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
});

export const pushEndpointSchema = z.object({ endpoint: z.string().trim().min(1).max(2048) });

export const pushDeviceSchema = z.object({ subscriptionId: z.uuid() });
