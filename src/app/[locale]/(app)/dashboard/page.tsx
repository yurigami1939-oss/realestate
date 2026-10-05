import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { StatsBar } from "@/components/inventory/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireTenantCtx } from "@/server/auth/page-guard";
import { getDashboard } from "@/server/dashboard/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("dashboard") };
}

/** One figure with its label, an optional comparison line and an optional link. */
function Kpi({
  label,
  value,
  hint,
  href,
  tone = "default",
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "default" | "alert";
  testId?: string;
}) {
  const body = (
    <>
      <div className={cn("text-sm", tone === "alert" ? "text-red-900" : "text-muted-foreground")}>
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums">
        <bdi dir="ltr">{value}</bdi>
      </div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </>
  );
  const className = cn(
    "block space-y-1 rounded-lg border p-3 text-start",
    tone === "alert" && "border-red-300 bg-red-50 text-red-950",
    href && "transition-colors hover:bg-muted/50",
  );
  return href ? (
    <Link href={href} className={className} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requireTenantCtx();
  const data = await getDashboard(ctx);
  const t = await getTranslations();
  const money = (v: bigint) => formatDZD(v, locale);
  const monthLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${data.month}T00:00:00Z`));
  const { todo } = data;
  const hasTodo =
    (todo.withdrawals?.length ?? 0) > 0 ||
    (todo.cheques?.count ?? 0) > 0 ||
    (todo.commissions?.count ?? 0) > 0 ||
    (todo.options?.length ?? 0) > 0 ||
    (todo.milestones?.length ?? 0) > 0 ||
    (todo.handovers?.length ?? 0) > 0 ||
    (todo.lateReserves ?? 0) > 0 ||
    (todo.rents?.count ?? 0) > 0 ||
    (todo.endingLeases?.length ?? 0) > 0 ||
    (todo.onlineIssues ?? 0) > 0 ||
    (todo.lateDeliveries ?? 0) > 0 ||
    (todo.documents?.expiring ?? 0) > 0 ||
    (todo.documents?.incomplete ?? 0) > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("home.title")}</h1>
        <p className="text-muted-foreground">
          {t("dashboard.asOf", { date: formatDate(data.today), month: monthLabel })}
        </p>
      </div>

      {hasTodo ? (
        <Section title={t("dashboard.todo.title")} testId="dashboard-todo">
          <ul className="divide-y text-sm">
            {todo.withdrawals?.map((w) => (
              <li key={w.reservationId} className="py-2">
                <Link href={`/sales/${w.reservationId}`} className="font-medium hover:underline">
                  {t("dashboard.todo.withdrawal", { number: w.number, buyer: w.buyer })}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {t("dashboard.todo.withdrawalRefund", { amount: money(w.refund) })}
                </span>
              </li>
            ))}
            {todo.milestones?.map((m) => (
              <li key={m.id} className="py-2">
                <Link
                  href={`/projects/${m.projectId}/payment-plans`}
                  className="font-medium hover:underline"
                >
                  {t("dashboard.todo.milestone", { project: m.projectName, name: m.name })}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {t("dashboard.todo.milestonePlanned", {
                    date: m.plannedOn ? formatDate(m.plannedOn) : "—",
                  })}
                </span>
              </li>
            ))}
            {todo.handovers?.map((h) => (
              <li key={h.saleId} className="py-2">
                <Link href={`/deliveries/${h.saleId}`} className="font-medium hover:underline">
                  {t("dashboard.todo.handover", { unit: h.unitCode, project: h.projectName })}
                </Link>
                {h.scheduledAt ? (
                  <span className="block text-xs text-muted-foreground">
                    {t("dashboard.todo.handoverAt", { date: formatDateTime(h.scheduledAt) })}
                  </span>
                ) : null}
              </li>
            ))}
            {todo.lateReserves ? (
              <li className="py-2">
                <Link
                  href={{ pathname: "/deliveries", query: { state: "reserves" } }}
                  className="hover:underline"
                >
                  {t("dashboard.todo.lateReserves", { count: todo.lateReserves })}
                </Link>
              </li>
            ) : null}
            {todo.lateDeliveries ? (
              <li className="py-2">
                <Link
                  href={{ pathname: "/deliveries", query: { state: "all" } }}
                  className="hover:underline"
                >
                  {t("dashboard.todo.lateDeliveries", { count: todo.lateDeliveries })}
                </Link>
              </li>
            ) : null}
            {todo.documents?.expiring ? (
              <li className="py-2">
                <Link href="/projects" className="hover:underline">
                  {t("dashboard.todo.documentsExpiring", { count: todo.documents.expiring })}
                </Link>
              </li>
            ) : null}
            {todo.documents?.incomplete ? (
              <li className="py-2">
                <Link href="/projects" className="hover:underline">
                  {t("dashboard.todo.documentsIncomplete", { count: todo.documents.incomplete })}
                </Link>
              </li>
            ) : null}
            {todo.endingLeases?.map((l) => (
              <li key={l.id} className="py-2">
                <Link href={`/rentals/${l.id}`} className="font-medium hover:underline">
                  {t("dashboard.todo.lease", { number: l.number, unit: l.unitCode })}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {t("dashboard.todo.leaseEnds", {
                    tenant: l.tenantName,
                    date: formatDate(l.endOn),
                  })}
                </span>
              </li>
            ))}
            {todo.onlineIssues ? (
              <li className="py-2">
                <Link
                  href={{ pathname: "/online-payments", query: { issues: "1" } }}
                  className="hover:underline"
                >
                  {t("dashboard.todo.onlinePayments", { count: todo.onlineIssues })}
                </Link>
              </li>
            ) : null}
            {todo.rents && todo.rents.count > 0 ? (
              <li className="py-2">
                <Link href="/rentals/overdue" className="hover:underline">
                  {t("dashboard.todo.rents", {
                    count: todo.rents.count,
                    amount: money(todo.rents.value),
                  })}
                </Link>
              </li>
            ) : null}
            {todo.options?.map((o) => (
              <li key={o.unitId} className="py-2">
                <Link
                  href={`/projects/${o.projectId}/units/${o.unitId}`}
                  className="font-medium hover:underline"
                >
                  {t("dashboard.todo.option", { unit: o.unitCode, lead: o.leadName })}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {t("dashboard.todo.optionExpires", { date: formatDateTime(o.expiresAt) })}
                </span>
              </li>
            ))}
            {todo.cheques && todo.cheques.count > 0 ? (
              <li className="py-2">
                {t("dashboard.todo.cheques", {
                  count: todo.cheques.count,
                  amount: money(todo.cheques.value),
                })}
              </li>
            ) : null}
            {todo.commissions && todo.commissions.count > 0 ? (
              <li className="py-2">
                <Link
                  href={{ pathname: "/commissions", query: { status: "earned" } }}
                  className="hover:underline"
                >
                  {t("dashboard.todo.commissions", {
                    count: todo.commissions.count,
                    amount: money(todo.commissions.value),
                  })}
                </Link>
              </li>
            ) : null}
          </ul>
        </Section>
      ) : null}

      {data.sales ? (
        <Section title={t("dashboard.sales.title")} testId="dashboard-sales">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label={t("dashboard.sales.reservationsMonth")}
              value={data.sales.month.reservations.count}
              hint={t("dashboard.sales.valueAndPrevious", {
                value: money(data.sales.month.reservations.value),
                previous: data.sales.previousMonth.reservations.count,
              })}
              href="/sales"
            />
            <Kpi
              label={t("dashboard.sales.vspMonth")}
              value={data.sales.month.sales.count}
              hint={t("dashboard.sales.valueAndPrevious", {
                value: money(data.sales.month.sales.value),
                previous: data.sales.previousMonth.sales.count,
              })}
              href="/sales?status=sold"
            />
            <Kpi
              label={t("dashboard.sales.reservationsYear")}
              value={data.sales.year.reservations.count}
              hint={money(data.sales.year.reservations.value)}
            />
            <Kpi
              label={t("dashboard.sales.vspYear")}
              value={data.sales.year.sales.count}
              hint={money(data.sales.year.sales.value)}
            />
          </div>
        </Section>
      ) : null}

      {data.collections ? (
        <Section title={t("dashboard.collections.title")} testId="dashboard-collections">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label={t("dashboard.collections.month")}
              value={money(data.collections.month)}
              hint={t("dashboard.collections.previous", {
                amount: money(data.collections.previousMonth),
              })}
            />
            <Kpi
              label={t("dashboard.collections.remaining")}
              value={money(data.collections.remaining)}
              hint={t("dashboard.collections.due", { amount: money(data.collections.due) })}
            />
            <Kpi
              label={t("dashboard.collections.overdue")}
              value={money(data.collections.overdue)}
              hint={t("dashboard.collections.overdueSales", {
                count: data.collections.overdueSales,
              })}
              href="/sales/overdue"
              tone={data.collections.overdue > 0n ? "alert" : "default"}
              testId="dashboard-overdue"
            />
            <Kpi
              label={t("dashboard.collections.next30Days")}
              value={money(data.collections.next30Days)}
            />
          </div>
        </Section>
      ) : null}

      {data.stock ? (
        <Section title={t("dashboard.stock.title")} testId="dashboard-stock">
          {data.stock.projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("dashboard.stock.empty")}{" "}
              <Link href="/projects" className="underline">
                {t("nav.projects")}
              </Link>
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Kpi
                  label={t("dashboard.stock.value")}
                  value={money(data.stock.stockValue)}
                  hint={t("dashboard.stock.availableOf", {
                    available: data.stock.totals.available,
                    units: data.stock.totals.units,
                  })}
                />
                <div className="rounded-lg border p-3">
                  <StatsBar stats={data.stock.totals} />
                </div>
              </div>
              <ul className="space-y-3">
                {data.stock.projects.map((p) => (
                  <li key={p.projectId} className="space-y-1.5">
                    <Link
                      href={`/projects/${p.projectId}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    <StatsBar stats={p} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      ) : null}

      {data.pipeline ? (
        <Section title={t("dashboard.pipeline.title")} testId="dashboard-pipeline">
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi
              label={t("dashboard.pipeline.newLeads")}
              value={data.pipeline.newLeads}
              href="/leads"
            />
            <Kpi
              label={t("dashboard.pipeline.lateFollowUps")}
              value={data.pipeline.lateFollowUps}
              href="/follow-ups"
              tone={data.pipeline.lateFollowUps > 0 ? "alert" : "default"}
            />
            <Kpi
              label={t("dashboard.pipeline.won")}
              value={data.pipeline.stages.won ?? 0}
              hint={t("dashboard.pipeline.lost", { count: data.pipeline.stages.lost ?? 0 })}
              href="/leads/pipeline"
            />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {(["new", "contacted", "visit_scheduled", "visited", "negotiation"] as const).map(
              (stage) => (
                <div key={stage} className="rounded-md border p-2">
                  <dt className="text-muted-foreground">{t(`crm.stage.${stage}`)}</dt>
                  <dd className="font-semibold tabular-nums">
                    {data.pipeline?.stages[stage] ?? 0}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </Section>
      ) : null}
    </div>
  );
}
