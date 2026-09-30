import { useTranslations } from "next-intl";

import type { LeadStage, VisitStatus } from "@/lib/crm";
import { cn } from "@/lib/utils";

/** Pipeline colors, shared by badges and the kanban. */
export const leadStageClasses: Record<LeadStage, string> = {
  new: "border-sky-300 bg-sky-50 text-sky-900",
  contacted: "border-indigo-300 bg-indigo-50 text-indigo-900",
  visit_scheduled: "border-violet-300 bg-violet-50 text-violet-900",
  visited: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-900",
  negotiation: "border-amber-300 bg-amber-50 text-amber-900",
  won: "border-emerald-300 bg-emerald-100 text-emerald-950",
  lost: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

const pill =
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function LeadStageBadge({ stage, className }: { stage: LeadStage; className?: string }) {
  const t = useTranslations("crm.stage");
  return <span className={cn(pill, leadStageClasses[stage], className)}>{t(stage)}</span>;
}

const visitStatusClasses: Record<VisitStatus, string> = {
  planned: "border-sky-300 bg-sky-50 text-sky-900",
  done: "border-emerald-300 bg-emerald-50 text-emerald-900",
  cancelled: "border-zinc-300 bg-zinc-100 text-zinc-700",
  no_show: "border-rose-300 bg-rose-50 text-rose-900",
};

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  const t = useTranslations("crm.visitStatus");
  return <span className={cn(pill, visitStatusClasses[status])}>{t(status)}</span>;
}
