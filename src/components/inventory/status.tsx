import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { ProjectStatus, UnitStatus } from "@/lib/inventory";
import { cn } from "@/lib/utils";

/** Availability colors, shared by the grid, badges and legend. */
export const unitStatusClasses: Record<UnitStatus, string> = {
  available: "border-emerald-300 bg-emerald-50 text-emerald-900",
  optioned: "border-amber-300 bg-amber-50 text-amber-900",
  reserved: "border-orange-300 bg-orange-100 text-orange-950",
  sold: "border-rose-300 bg-rose-100 text-rose-950",
  delivered: "border-slate-400 bg-slate-200 text-slate-900",
  rented: "border-violet-300 bg-violet-100 text-violet-950",
  blocked: "border-zinc-700 bg-zinc-700 text-zinc-50",
};

export function UnitStatusBadge({ status, className }: { status: UnitStatus; className?: string }) {
  const t = useTranslations("inventory.unitStatus");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        unitStatusClasses[status],
        className,
      )}
    >
      {t(status)}
    </span>
  );
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations("inventory.projectStatus");
  return <Badge variant={status === "delivered" ? "secondary" : "outline"}>{t(status)}</Badge>;
}

export type Stats = {
  units: number;
  available: number;
  engaged: number;
  sold: number;
  unavailable: number;
};

const segments = [
  { key: "available", className: "bg-emerald-500" },
  { key: "engaged", className: "bg-amber-500" },
  { key: "sold", className: "bg-rose-500" },
  { key: "unavailable", className: "bg-zinc-500" },
] as const;

/** Stacked bar of the commercial state of a set of units, with counts. */
export function StatsBar({ stats }: { stats: Stats }) {
  const t = useTranslations("inventory.stats");
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        {stats.units > 0
          ? segments.map((s) => (
              <div
                key={s.key}
                className={s.className}
                style={{ width: `${(stats[s.key] / stats.units) * 100}%` }}
              />
            ))
          : null}
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1">
          <dt>{t("units")}</dt>
          <dd className="font-medium text-foreground">{stats.units}</dd>
        </div>
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-1">
            <span className={cn("size-2 rounded-full", s.className)} aria-hidden />
            <dt>{t(s.key)}</dt>
            <dd className="font-medium text-foreground">{stats[s.key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** "RDC", "Étage 3", "Sous-sol 1". */
export function useFloorLabel() {
  const t = useTranslations("inventory.floor");
  return (floor: number) =>
    floor === 0
      ? t("ground")
      : floor > 0
        ? t("upper", { floor })
        : t("basement", { level: -floor });
}
