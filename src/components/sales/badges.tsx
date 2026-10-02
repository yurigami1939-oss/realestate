import { useTranslations } from "next-intl";

import type { ReservationStatus } from "@/lib/sales";
import type { InstallmentState } from "@/lib/statement";
import { cn } from "@/lib/utils";

const badge =
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const saleStatusClasses: Record<ReservationStatus, string> = {
  reserved: "border-orange-300 bg-orange-100 text-orange-950",
  sold: "border-rose-300 bg-rose-100 text-rose-950",
  withdrawn: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

/** Same colors as the unit it engages (reserved / sold); withdrawn sales are muted. */
export function SaleStatusBadge({ status }: { status: ReservationStatus }) {
  const t = useTranslations("sales.status");
  return <span className={cn(badge, saleStatusClasses[status])}>{t(status)}</span>;
}

const installmentStateClasses: Record<InstallmentState, string> = {
  paid: "border-emerald-300 bg-emerald-50 text-emerald-900",
  overdue: "border-red-300 bg-red-50 text-red-900",
  due: "border-amber-300 bg-amber-50 text-amber-900",
  upcoming: "border-sky-200 bg-sky-50 text-sky-900",
  pending: "border-zinc-200 bg-zinc-50 text-zinc-600",
};

export function InstallmentStateBadge({ state }: { state: InstallmentState }) {
  const t = useTranslations("sales.statement.state");
  return <span className={cn(badge, installmentStateClasses[state])}>{t(state)}</span>;
}
