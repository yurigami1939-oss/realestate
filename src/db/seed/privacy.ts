/**
 * The demo company's retention periods (Loi 18-07, CLAUDE.md §7 Personal data): example figures
 * the gérant would set with its legal adviser — prospects 36 months after their last activity,
 * message logs 24 months. The seeded records are recent: nothing is erased.
 */
import type { TenantCtx } from "@/server/auth/session";
import { savePrivacySettings } from "@/server/privacy/retention";
import { privacySettingsSchema } from "@/server/privacy/schemas";

export async function seedPrivacy(owner: TenantCtx) {
  await savePrivacySettings(
    owner,
    privacySettingsSchema.parse({ leadRetentionMonths: "36", messageRetentionMonths: "24" }),
  );
}
