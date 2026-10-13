import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { SubscriptionStatusBadge } from "@/components/subscription/subscription-status-badge";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate, toCalendarDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { subscriptionStatuses } from "@/lib/subscriptions";
import { getBillingOverview } from "@/server/console/billing";
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
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const operator = await requireOperator();
  const {
    counts,
    pilotsEnding,
    beyondGrace,
    unentitled,
    provisionsWaiting,
    overUnits,
    overStorage,
  } = await getConsoleOverview(operator);
  const billing = await getBillingOverview();
  const t = await getTranslations("console.overview");
  const ts = await getTranslations("subscription.status");
  const ending = (rows: typeof pilotsEnding) =>
    rows.map((r) => ({
      key: r.id,
      href: `/console/accounts/${r.id}`,
      label: r.legalName,
      detail: r.pilotEndsOn ? t("endsOn", { date: formatDate(r.pilotEndsOn) }) : "",
    }));
  const nothing =
    pilotsEnding.length +
      beyondGrace.length +
      unentitled.length +
      provisionsWaiting.length +
      overUnits.length +
      overStorage.length +
      billing.toInvoice.length +
      billing.invoicesBeyondGrace.length ===
    0;

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

      <div className="grid gap-3 sm:grid-cols-2" data-testid="billing-figures">
        <div className="space-y-1 rounded-2xl bg-card p-4 shadow-card">
          <div className="text-footnote text-muted-foreground">{t("mrr")}</div>
          <div className="text-title tabular-nums">{formatDZD(billing.mrr, locale)}</div>
        </div>
        <Link
          href="/console/invoices"
          className="space-y-1 rounded-2xl bg-card p-4 shadow-card transition-shadow hover:shadow-raised"
        >
          <div className="text-footnote text-muted-foreground">{t("unpaid")}</div>
          <div className="text-title tabular-nums">{formatDZD(billing.unpaid, locale)}</div>
        </Link>
      </div>

      <div className="space-y-6">
        <h2 className="text-title">{t("todo")}</h2>
        {nothing ? <p className="empty-state">{t("none")}</p> : null}
        <TodoList title={t("pilotsEnding")} rows={ending(pilotsEnding)} />
        <TodoList title={t("beyondGrace")} rows={ending(beyondGrace)} />
        <TodoList
          title={t("invoicesBeyondGrace")}
          rows={billing.invoicesBeyondGrace.map((a) => ({
            key: a.id,
            href: `/console/accounts/${a.id}`,
            label: a.legalName,
            detail: t("invoiceDue", { number: a.number, date: formatDate(a.dueOn) }),
          }))}
        />
        <TodoList
          title={t("toInvoice")}
          rows={billing.toInvoice.map((a) => ({
            key: a.id,
            href: `/console/accounts/${a.id}`,
            label: a.legalName,
            detail: a.invoicedUntil
              ? t("invoicedUntil", { date: formatDate(a.invoicedUntil) })
              : t("notInvoiced"),
          }))}
        />
        <TodoList
          title={t("overUnits")}
          rows={overUnits.map((a) => ({
            key: a.id,
            href: `/console/accounts/${a.id}`,
            label: a.legalName,
            detail: t("unitsDetail", { used: a.activeUnits, cap: a.unitsCap ?? 0 }),
          }))}
        />
        <TodoList
          title={t("overStorage")}
          rows={overStorage.map((a) => ({
            key: a.id,
            href: `/console/accounts/${a.id}`,
            label: a.legalName,
            detail: t("storageDetail", {
              used: Math.round(a.storageBytes / 1e9),
              cap: a.storageGb ?? 0,
            }),
          }))}
        />
        <TodoList
          title={t("provisionsWaiting")}
          rows={provisionsWaiting.map((p) => ({
            key: p.id,
            href: "/console/provisions",
            label: p.legalName,
            detail: t("sentOn", { date: formatDate(toCalendarDate(p.createdAt)) }),
          }))}
        />
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
