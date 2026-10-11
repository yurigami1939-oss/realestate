import { useTranslations } from "next-intl";

import type { LeadStage, VisitStatus } from "@/lib/crm";
import { cn } from "@/lib/utils";

/** Pipeline colors, shared by badges and the kanban. */
export const leadStageClasses: Record<LeadStage, string> = {
  new: "border-info/25 bg-info-soft text-info",
  contacted: "border-indigo/25 bg-indigo-soft text-indigo",
  visit_scheduled: "border-purple/25 bg-purple-soft text-purple",
  visited: "border-pink/25 bg-pink-soft text-pink",
  negotiation: "border-warning/25 bg-warning-soft text-warning",
  won: "border-success/25 bg-success-soft text-success",
  lost: "border-border bg-muted text-muted-foreground",
};

const pill =
  "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap";

export function LeadStageBadge({ stage, className }: { stage: LeadStage; className?: string }) {
  const t = useTranslations("crm.stage");
  return <span className={cn(pill, leadStageClasses[stage], className)}>{t(stage)}</span>;
}

const visitStatusClasses: Record<VisitStatus, string> = {
  planned: "border-info/25 bg-info-soft text-info",
  done: "border-success/25 bg-success-soft text-success",
  cancelled: "border-border bg-muted text-muted-foreground",
  no_show: "border-danger/25 bg-danger-soft text-danger",
};

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  const t = useTranslations("crm.visitStatus");
  return <span className={cn(pill, visitStatusClasses[status])}>{t(status)}</span>;
}
