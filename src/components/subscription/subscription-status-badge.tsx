import { useTranslations } from "next-intl";

import type { SubscriptionStatus } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";

const classes: Record<SubscriptionStatus, string> = {
  pilot: "border-info/25 bg-info-soft text-info",
  active: "border-success/25 bg-success-soft text-success",
  past_due: "border-warning/25 bg-warning-soft text-warning",
  suspended: "border-danger/25 bg-danger-soft text-danger",
  terminated: "border-border bg-muted text-muted-foreground",
};

/** The state of a subscription (CLAUDE.console.md §6) as a capsule. */
export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  const t = useTranslations("subscription.status");
  return (
    <span
      className={cn(
        "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        classes[status],
      )}
    >
      {t(status)}
    </span>
  );
}
