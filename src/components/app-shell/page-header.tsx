import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

export type Crumb = { label: string; href?: string };

/** Page title with optional breadcrumbs and actions (start/end aware). */
export function PageHeader({
  title,
  description,
  crumbs = [],
  actions,
  badge,
}: {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <div className="space-y-3">
      {crumbs.length > 0 ? (
        <nav
          aria-label={t("breadcrumb")}
          className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
        >
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.href ? (
                <Link href={c.href} className="hover:text-foreground hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
              <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{title}</h1>
            {badge}
          </div>
          {description ? <p className="text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
