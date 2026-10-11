/**
 * The demo company's SMS account (CLAUDE.md §7 SMS) on the local gateway stand-in: receipts and
 * reminders go by SMS to those WhatsApp does not reach; one number asked for no more SMS. Set up
 * last, like WhatsApp, so the seeded events sent nothing.
 */
import type { TenantCtx } from "@/server/auth/session";
import { smsOptOutSchema, smsSettingsSchema } from "@/server/sms/schemas";
import { addSmsOptOut, saveSmsSettings } from "@/server/sms/service";

export async function seedSms(owner: TenantCtx) {
  await saveSmsSettings(
    owner,
    smsSettingsSchema.parse({
      enabled: true,
      provider: "mobilis",
      apiUrl: "",
      sender: "PROMO-DZ",
      apiKey: "demo-sms-key",
      language: "fr",
      kinds: [
        "payment_received",
        "payment_reminder",
        "charge_received",
        "charge_reminder",
        "rent_received",
      ],
    }),
  );
  await addSmsOptOut(
    owner,
    smsOptOutSchema.parse({ phone: "0661 93 28 40", reason: "Demande par téléphone" }),
  );
}
