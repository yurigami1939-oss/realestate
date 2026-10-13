import { cn } from "@/lib/utils";

/**
 * One figure of the subscription's usage against its cap (CLAUDE.console.md §7): a bar in the
 * accent, orange from 80 %, red beyond the cap; no bar without a cap.
 */
export function UsageMeter({
  label,
  hint,
  value,
  used,
  cap,
}: {
  label: string;
  hint?: string;
  /** The figure as shown (« 120 sur 300 »). */
  value: string;
  used: number;
  cap: number | null;
}) {
  const share = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const tone =
    cap && used > cap ? "bg-danger-vivid" : share >= 80 ? "bg-warning-vivid" : "bg-primary";
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground tabular-nums">{value}</span>
      </div>
      {cap ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${share}%` }} />
        </div>
      ) : null}
      {hint ? <p className="text-footnote text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
