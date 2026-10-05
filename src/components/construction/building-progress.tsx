import { useTranslations } from "next-intl";

import { formatDate } from "@/lib/dates";
import { formatShare } from "@/lib/payment-plans";

/** Progress of the works of a building: name, bar and percent, with the day it was reported. */
export function BuildingProgressBar({
  name,
  progress,
}: {
  name: string;
  progress: { percent: number; reportedOn: string } | null;
}) {
  const t = useTranslations("construction.progress");
  const percent = progress?.percent ?? 0;
  return (
    <div className="space-y-1" data-building={name}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{name}</span>
        <span className="font-semibold tabular-nums" dir="ltr">
          {progress ? formatShare(percent * 100) : "—"}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {progress ? t("asOf", { date: formatDate(progress.reportedOn) }) : t("none")}
      </p>
    </div>
  );
}
