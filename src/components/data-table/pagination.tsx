import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** Previous / next links that keep the other search params (server component). */
export function Pagination({
  pathname,
  params,
  page,
  pageSize,
  total,
}: {
  pathname: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const t = useTranslations("common.pagination");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (target: number) => {
    const query = Object.fromEntries(
      Object.entries({ ...params, page: target > 1 ? String(target) : undefined }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "",
      ),
    );
    return { pathname, query };
  };

  return (
    <nav className="flex items-center justify-between gap-2" aria-label={t("label")}>
      <p className="text-sm text-muted-foreground">{t("page", { page, pages })}</p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)} rel="prev">
              <ChevronLeft data-icon="inline-start" className="rtl:rotate-180" />
              {t("previous")}
            </Link>
          </Button>
        ) : null}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)} rel="next">
              {t("next")}
              <ChevronRight data-icon="inline-end" className="rtl:rotate-180" />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
