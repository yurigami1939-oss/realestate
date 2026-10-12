import { ChevronRight } from "lucide-react";

import { Link } from "@/i18n/navigation";

import { type PortalIconKey, portalIcons } from "./portal-icons";

export type PortalRow = {
  key: string;
  href?: string;
  icon?: PortalIconKey;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
};

/**
 * An iOS inset grouped list (CLAUDE.md §14 item 17): white rounded rows with an inset divider,
 * an optional tinted icon, the whole row opening its page with a chevron at its end.
 */
export function PortalRows({ rows, testId }: { rows: PortalRow[]; testId?: string }) {
  return (
    <ul className="overflow-hidden rounded-xl bg-card shadow-card" data-testid={testId}>
      {rows.map((row) => {
        const Icon = row.icon ? portalIcons[row.icon] : null;
        const body = (
          <>
            {Icon ? (
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              >
                <Icon className="size-4.5" />
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] font-medium">{row.title}</span>
              {row.subtitle ? (
                <span className="block truncate text-footnote text-muted-foreground">
                  {row.subtitle}
                </span>
              ) : null}
            </span>
            {row.trailing}
            {row.href ? (
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground/70 rtl:rotate-180"
                aria-hidden
              />
            ) : null}
          </>
        );
        const className = "flex min-h-14 items-center gap-3 px-4 py-3";
        return (
          <li
            key={row.key}
            className="relative not-last:after:absolute not-last:after:start-4 not-last:after:end-0 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-border"
          >
            {row.href ? (
              <Link href={row.href} className={`${className} transition-colors hover:bg-muted/40`}>
                {body}
              </Link>
            ) : (
              <div className={className}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
