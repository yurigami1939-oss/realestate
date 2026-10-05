import { useTranslations } from "next-intl";

import type { DeliveryState, PunchStatus } from "@/lib/handovers";
import { cn } from "@/lib/utils";

const stateClasses: Record<DeliveryState, string> = {
  not_ready: "border-zinc-300 bg-zinc-50 text-zinc-700",
  to_schedule: "border-amber-300 bg-amber-50 text-amber-900",
  scheduled: "border-sky-300 bg-sky-50 text-sky-900",
  reserves: "border-orange-300 bg-orange-50 text-orange-900",
  delivered: "border-emerald-300 bg-emerald-50 text-emerald-900",
};

const badge = "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium";

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
  open: "border-orange-300 bg-orange-50 text-orange-900",
  lifted: "border-emerald-300 bg-emerald-50 text-emerald-900",
  cancelled: "border-zinc-300 bg-zinc-50 text-zinc-600",
};

export function PunchStatusBadge({ status }: { status: PunchStatus }) {
  const t = useTranslations("handovers.punchStatus");
  return <span className={cn(badge, punchClasses[status])}>{t(status)}</span>;
}
