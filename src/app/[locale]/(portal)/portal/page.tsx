import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PortalRows } from "@/components/portal/portal-rows";
import { SaleStatusBadge } from "@/components/sales/badges";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate, toCalendarDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { getPortalOverview } from "@/server/portal/queries";
import { listPortalAnnouncements } from "@/server/portal/residences";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.shell");
  return { title: t("title") };
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-4 text-footnote font-semibold text-muted-foreground">{children}</h2>;
}

/**
 * Portal home (CLAUDE.md §14 item 17): each purchase as a card — its balance, how much is paid
 * and the next installment —, the units in residence and the leases as grouped rows, and the
 * latest announcement of the account's residences.
 */
export default async function PortalHomePage({ params }: PageProps<"/[locale]/portal">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requirePortalCtx();
  const { sales, units, leases } = await getPortalOverview(ctx);
  const [news] = units.length > 0 ? await listPortalAnnouncements(ctx) : [];
  const t = await getTranslations("portal.home");
  const money = (v: bigint) => formatDZD(v, locale);

  return (
    <div className="space-y-8">
      <h1 className="text-large-title">{t("welcome", { name: ctx.name })}</h1>
      {sales.length === 0 && units.length === 0 && leases.length === 0 ? (
        <p className="empty-state">{t("empty")}</p>
      ) : null}

      {sales.length > 0 ? (
        <section className="space-y-2">
          <GroupTitle>{t("sales")}</GroupTitle>
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="portal-sales">
            {sales.map((s) => {
              const share = s.price > 0n ? Number((s.paid * 1000n) / s.price) / 10 : 0;
              return (
                <li key={s.id}>
                  <Link
                    href={`/portal/sales/${s.id}`}
                    className="block space-y-4 rounded-2xl bg-card p-5 shadow-card transition-shadow duration-200 ease-apple hover:shadow-raised"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-headline">
                          {s.projectName} · <bdi dir="ltr">{s.unitCode}</bdi>
                        </div>
                        <div className="text-footnote text-muted-foreground">
                          <bdi dir="ltr">{s.number}</bdi> ·{" "}
                          {t("reservedOn", { date: formatDate(s.reservedOn) })}
                        </div>
                      </div>
                      <SaleStatusBadge status={s.status} />
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-full rounded-full bg-success-vivid"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-footnote text-muted-foreground">{t("paid")}</dt>
                        <dd className="font-semibold tabular-nums">
                          <bdi dir="ltr">{money(s.paid)}</bdi>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-footnote text-muted-foreground">{t("remaining")}</dt>
                        <dd className="font-semibold tabular-nums">
                          <bdi dir="ltr">{money(s.remaining)}</bdi>
                        </dd>
                      </div>
                    </dl>
                    <div
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm",
                        s.overdue > 0n ? "bg-danger-soft text-danger" : "bg-muted/50",
                      )}
                    >
                      {s.overdue > 0n ? (
                        <span className="font-medium">
                          {t("overdue", { amount: money(s.overdue) })}
                        </span>
                      ) : s.next ? (
                        <span>
                          <span className="text-muted-foreground">{t("next")} </span>
                          <span className="font-medium tabular-nums">
                            <bdi dir="ltr">{money(s.next.amount)}</bdi>
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {s.next.dueOn ? t("nextOn", { date: formatDate(s.next.dueOn) }) : null}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("upToDate")}</span>
                      )}
                      <ChevronRight
                        className="size-4 shrink-0 opacity-60 rtl:rotate-180"
                        aria-hidden
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {news ? (
        <section className="space-y-2">
          <GroupTitle>{t("news")}</GroupTitle>
          <Link
            href="/portal/announcements"
            className="block space-y-1.5 rounded-2xl bg-card p-5 shadow-card transition-shadow duration-200 ease-apple hover:shadow-raised"
            data-testid="portal-news"
          >
            <div className="text-footnote text-muted-foreground">
              {news.residenceName}
              {news.publishedAt ? ` · ${formatDate(toCalendarDate(news.publishedAt))}` : null}
            </div>
            <div className="text-headline">
              {locale === "ar" && news.titleAr ? news.titleAr : news.title}
            </div>
            <div className="line-clamp-2 text-sm text-muted-foreground">
              {locale === "ar" && news.bodyAr ? news.bodyAr : news.body}
            </div>
            <div className="pt-1 text-sm font-medium text-primary">{t("allNews")}</div>
          </Link>
        </section>
      ) : null}

      {units.length > 0 ? (
        <section className="space-y-2">
          <GroupTitle>{t("units")}</GroupTitle>
          <PortalRows
            testId="portal-units"
            rows={units.flatMap((u) => [
              {
                key: u.residentId,
                href: u.kind === "co_owner" ? `/portal/units/${u.unitId}` : undefined,
                icon: "home" as const,
                title: (
                  <>
                    {u.residenceName} · <bdi dir="ltr">{u.unitCode}</bdi>
                  </>
                ),
                trailing: <Badge variant="outline">{t(`kind.${u.kind}`)}</Badge>,
              },
              ...(u.kind === "co_owner" && u.councilMember
                ? [
                    {
                      key: `${u.residentId}-council`,
                      href: `/portal/council/${u.residenceId}`,
                      icon: "assemblies" as const,
                      title: t("council"),
                    },
                  ]
                : []),
            ])}
          />
        </section>
      ) : null}

      {leases.length > 0 ? (
        <section className="space-y-2">
          <GroupTitle>{t("leases")}</GroupTitle>
          <PortalRows
            testId="portal-leases"
            rows={leases.map((l) => ({
              key: l.id,
              href: `/portal/leases/${l.id}`,
              icon: "documents" as const,
              title: (
                <>
                  {l.projectName} · <bdi dir="ltr">{l.unitCode}</bdi>
                </>
              ),
              subtitle: (
                <>
                  <bdi dir="ltr">{l.number}</bdi> ·{" "}
                  {t("leaseTerm", { from: formatDate(l.startOn), to: formatDate(l.endOn) })}
                </>
              ),
              trailing: <Badge variant="outline">{t(`leaseStatus.${l.status}`)}</Badge>,
            }))}
          />
        </section>
      ) : null}
    </div>
  );
}
