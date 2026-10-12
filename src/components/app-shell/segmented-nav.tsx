import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type Segment = { key: string; href: string; label: string };

/**
 * A record's sub-pages as a segmented control (CLAUDE.md §14 item 16): a gray track with the
 * current page raised in white; it scrolls sideways when the segments do not fit.
 */
export function SegmentedNav({
  label,
  segments,
  current,
}: {
  label: string;
  segments: Segment[];
  current: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex gap-0.5 rounded-xl bg-muted p-1">
        {segments.map((segment) => {
          const active = segment.key === current;
          return (
            <Link
              key={segment.key}
              href={segment.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-150",
                active
                  ? "bg-card font-medium text-foreground shadow-card"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {segment.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
