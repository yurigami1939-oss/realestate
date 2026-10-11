import { useTranslations } from "next-intl";

import type { ReservationStatus } from "@/lib/sales";
import type { InstallmentState } from "@/lib/statement";
import { cn } from "@/lib/utils";

const badge =
  "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap";

const saleStatusClasses: Record<ReservationStatus, string> = {
  reserved: "border-orange/25 bg-orange-soft text-orange",
  sold: "border-pink/25 bg-pink-soft text-pink",
  withdrawn: "border-border bg-muted text-muted-foreground",
};

/** Same colors as the unit it engages (reserved / sold); withdrawn sales are muted. */
export function SaleStatusBadge({ status }: { status: ReservationStatus }) {
  const t = useTranslations("sales.status");
  return <span className={cn(badge, saleStatusClasses[status])}>{t(status)}</span>;
}

const installmentStateClasses: Record<InstallmentState, string> = {
  paid: "border-success/25 bg-success-soft text-success",
  overdue: "border-danger/25 bg-danger-soft text-danger",
  due: "border-warning/25 bg-warning-soft text-warning",
  upcoming: "border-info/25 bg-info-soft text-info",
  pending: "border-border bg-muted text-muted-foreground",
};

/** State of an installment (or, with its own `label`, of a charge call). */
export function InstallmentStateBadge({
  state,
  label,
}: {
  state: InstallmentState;
  label?: string;
}) {
  const t = useTranslations("sales.statement.state");
  return <span className={cn(badge, installmentStateClasses[state])}>{label ?? t(state)}</span>;
}
