import { useTranslations } from "next-intl";

import type { TicketPriority, TicketStatus } from "@/lib/tickets";
import { cn } from "@/lib/utils";

const badge =
  "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap";

const statusClasses: Record<TicketStatus, string> = {
  open: "border-info/25 bg-info-soft text-info",
  in_progress: "border-warning/25 bg-warning-soft text-warning",
  resolved: "border-success/25 bg-success-soft text-success",
  closed: "border-border bg-muted text-muted-foreground",
  cancelled: "border-border bg-muted text-muted-foreground",
};

const priorityClasses: Record<TicketPriority, string> = {
  low: "border-border bg-muted text-muted-foreground",
  normal: "border-border bg-white text-foreground",
  high: "border-orange/25 bg-orange-soft text-orange",
  urgent: "border-danger/25 bg-danger-soft text-danger",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const t = useTranslations("tickets.status");
  return <span className={cn(badge, statusClasses[status])}>{t(status)}</span>;
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  const t = useTranslations("tickets.priority");
  return <span className={cn(badge, priorityClasses[priority])}>{t(priority)}</span>;
}
