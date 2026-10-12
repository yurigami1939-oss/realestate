import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { SubscriptionStatusBadge } from "@/components/subscription/subscription-status-badge";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate, toCalendarDate } from "@/lib/dates";
import { subscriptionStatuses } from "@/lib/subscriptions";
import { requireOperator } from "@/server/console/guard";
import { getConsoleOverview } from "@/server/console/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("console.overview");
  return { title: t("title") };
}

function TodoList({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; href?: string; label: string; detail: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="px-4 text-footnote font-semibold text-muted-foreground">{title}</h2>
      <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-card">
        {rows.map((row) => (
          <li key={row.key}>
            {row.href ? (
              <Link
                href={row.href}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.label}</span>
                  <span className="block text-footnote text-muted-foreground">{row.detail}</span>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground/60 rtl:rotate-180"
                  aria-hidden
                />
              </Link>
            ) : (
              <div className="px-4 py-3">
                <span className="block truncate text-sm font-medium">{row.label}</span>
                <span className="block text-footnote text-muted-foreground">{row.detail}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The console's home (CLAUDE.console.md §10): accounts by state and the to-dos. */
export default async function ConsoleHomePage({ params }: PageProps<"/[locale]/console">) {
  setRequestLocale(toLocale((await params).locale));
  const operator = await requireOperator();
  const { counts, pilotsEnding, beyondGrace, unentitled } = await getConsoleOverview(operator);
  const t = await getTranslations("console.overview");
  const ts = await getTranslations("subscription.status");
  const ending = (rows: typeof pilotsEnding) =>
    rows.map((r) => ({
      key: r.id,
      href: `/console/accounts/${r.id}`,
      label: r.legalName,
      detail: r.pilotEndsOn ? t("endsOn", { date: formatDate(r.pilotEndsOn) }) : "",
    }));
  const nothing = pilotsEnding.length + beyondGrace.length + unentitled.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="status-counts">
        {subscriptionStatuses.map((status) => (
          <Link
            key={status}
            href={`/console/accounts?status=${status}`}
            className="space-y-2 rounded-2xl bg-card p-4 shadow-card transition-shadow hover:shadow-raised"
          >
            <SubscriptionStatusBadge status={status} />
            <div className="text-[1.75rem] leading-none font-semibold tabular-nums">
              {counts[status]}
            </div>
            <div className="sr-only">{ts(status)}</div>
          </Link>
        ))}
      </div>

      <div className="space-y-6">
        <h2 className="text-title">{t("todo")}</h2>
        {nothing ? <p className="empty-state">{t("none")}</p> : null}
        <TodoList title={t("pilotsEnding")} rows={ending(pilotsEnding)} />
        <TodoList title={t("beyondGrace")} rows={ending(beyondGrace)} />
        <TodoList
          title={t("unentitled")}
          rows={unentitled.map((o) => ({
            key: o.id,
            label: o.name,
            detail: t("createdOn", { date: formatDate(toCalendarDate(o.createdAt)) }),
          }))}
        />
      </div>
    </div>
  );
}
