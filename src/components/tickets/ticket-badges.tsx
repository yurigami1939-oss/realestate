import { useTranslations } from "next-intl";

import type { TicketPriority, TicketStatus } from "@/lib/tickets";
import { cn } from "@/lib/utils";

const badge =
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const statusClasses: Record<TicketStatus, string> = {
  open: "border-sky-300 bg-sky-50 text-sky-900",
  in_progress: "border-amber-300 bg-amber-50 text-amber-900",
  resolved: "border-emerald-300 bg-emerald-50 text-emerald-900",
  closed: "border-zinc-300 bg-zinc-100 text-zinc-700",
  cancelled: "border-zinc-200 bg-zinc-50 text-zinc-500",
};

const priorityClasses: Record<TicketPriority, string> = {
  low: "border-zinc-200 bg-zinc-50 text-zinc-600",
  normal: "border-zinc-300 bg-white text-zinc-800",
  high: "border-orange-300 bg-orange-50 text-orange-900",
  urgent: "border-red-300 bg-red-100 text-red-900",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const t = useTranslations("tickets.status");
  return <span className={cn(badge, statusClasses[status])}>{t(status)}</span>;
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  const t = useTranslations("tickets.priority");
  return <span className={cn(badge, priorityClasses[priority])}>{t(priority)}</span>;
}
