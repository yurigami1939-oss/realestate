import { CircleAlert, Clock, Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { todayInAlgiers } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { readOnlyReason, type TenantAccess } from "@/server/entitlements/access";

const tones = {
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
} as const;

/**
 * The subscription's state above the page (CLAUDE.console.md §6): read-only for everyone
 * (suspended, terminated, no subscription); the pilot's days left and a pilot over or an invoice
 * overdue for those who read the subscription (`billing`: the gérant, the comptable). Nothing
 * when all is well. `portal`: the residents' wording, without the subscription link.
 */
export async function SubscriptionBanner({
  access,
  billing,
  portal = false,
  storageShare = null,
}: {
  access: TenantAccess | undefined;
  billing: boolean;
  portal?: boolean;
  /** Storage used against the plan's, in percent (soft cap: a warning from 80 %, §7). */
  storageShare?: number | null;
}) {
  if (!access) return null;
  const t = await getTranslations("subscription.banner");
  const reason = readOnlyReason(access);
  let tone: keyof typeof tones;
  let text: string;
  if (reason && reason !== "support") {
    tone = "danger";
    text = portal ? t("portalReadOnly") : t(`readOnly.${reason}`);
  } else if (!billing || portal) {
    return null;
  } else if (access.status === "past_due") {
    tone = "warning";
    text = access.pilotEndsOn && !access.currentPeriodEnd ? t("pilotOver") : t("pastDue");
  } else if (storageShare !== null && storageShare >= 80) {
    tone = "warning";
    text = t("storage", { pct: Math.round(storageShare) });
  } else if (access.status === "pilot" && access.pilotEndsOn) {
    const days = Math.max(
      0,
      Math.round((Date.parse(access.pilotEndsOn) - Date.parse(todayInAlgiers())) / 86_400_000),
    );
    tone = "info";
    text = days === 0 ? t("pilotLastDay") : t("pilotDays", { days });
  } else {
    return null;
  }
  const Icon = tone === "danger" ? Lock : tone === "warning" ? CircleAlert : Clock;
  return (
    <div
      role="status"
      data-testid="subscription-banner"
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-2 text-center text-footnote font-medium",
        tones[tone],
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
      {billing && !portal ? (
        <Link href="/settings/subscription" className="underline underline-offset-2">
          {t("link")}
        </Link>
      ) : null}
    </div>
  );
}
