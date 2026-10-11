import { useTranslations } from "next-intl";

import type { DeliveryState, PunchStatus } from "@/lib/handovers";
import { cn } from "@/lib/utils";

const stateClasses: Record<DeliveryState, string> = {
  not_ready: "border-border bg-muted text-muted-foreground",
  to_schedule: "border-warning/25 bg-warning-soft text-warning",
  scheduled: "border-info/25 bg-info-soft text-info",
  reserves: "border-orange/25 bg-orange-soft text-orange",
  delivered: "border-success/25 bg-success-soft text-success",
};

const badge = "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium";

/** Where the delivery of a sold unit stands. */
export function DeliveryStateBadge({ state }: { state: DeliveryState }) {
  const t = useTranslations("handovers.state");
  return (
    <span className={cn(badge, stateClasses[state])} data-state={state}>
      {t(state)}
    </span>
  );
}

const punchClasses: Record<PunchStatus, string> = {
  open: "border-orange/25 bg-orange-soft text-orange",
  lifted: "border-success/25 bg-success-soft text-success",
  cancelled: "border-border bg-muted text-muted-foreground",
};

export function PunchStatusBadge({ status }: { status: PunchStatus }) {
  const t = useTranslations("handovers.punchStatus");
  return <span className={cn(badge, punchClasses[status])}>{t(status)}</span>;
}
