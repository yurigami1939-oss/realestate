/**
 * Demo WhatsApp (CLAUDE.md §7): the demo promoter's number with every notification on, set up
 * after the rest of the seed (no message for the seeded history). Locally (DEV_GATEWAYS) the
 * Cloud API is the stand-in served by the app, which accepts these placeholder credentials.
 * Contacts who agreed: Mohamed Cherif (buyer and co-owner), Farid Mebarki (co-owner), the
 * Hamidi family (tenants).
 */
import { whatsappKinds } from "@/lib/whatsapp";
import type { TenantCtx } from "@/server/auth/session";
import { whatsappSettingsSchema } from "@/server/whatsapp/schemas";
import { saveWhatsappSettings } from "@/server/whatsapp/service";

export async function seedWhatsapp(owner: TenantCtx) {
  await saveWhatsappSettings(
    owner,
    whatsappSettingsSchema.parse({
      enabled: true,
      phoneNumberId: "100200300400500",
      businessAccountId: "",
      accessToken: "demo-whatsapp-token",
      appSecret: "demo-whatsapp-app-secret",
      language: "fr",
      notifications: whatsappKinds.map((kind) => ({ kind, enabled: true, template: "" })),
    }),
  );
}
