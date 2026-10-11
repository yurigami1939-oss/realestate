import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrivalButton, LogVisitorDialog } from "@/components/visitors/visitor-dialogs";
import { toLocale } from "@/i18n/locales";
import { type CalendarDate, formatDate, todayInAlgiers } from "@/lib/dates";
import { accessOf, can } from "@/lib/permissions";
import type { VisitorStatus } from "@/lib/visitors";
import { requirePermission } from "@/server/auth/page-guard";
import { getResidence } from "@/server/residences/queries";
import { timeOf } from "@/server/rooms/service";
import { listVisitors } from "@/server/visitors/service";

import { ResidenceNav } from "../_components/residence-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("visitors");
  return { title: t("title") };
}

const statusClass: Record<VisitorStatus, string> = {
  expected: "text-amber-800",
  arrived: "text-emerald-800",
  cancelled: "text-muted-foreground",
};

const isDay = (value: unknown): value is CalendarDate =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * The visitors' register of a residence for a day (today by default): those announced by the
 * residents with their code (a code searched for), those who came; the gate records arrivals.
 */
export default async function ResidenceVisitorsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/residences/[residenceId]/visitors">) {
  const { locale: raw, residenceId } = await params;
  setRequestLocale(toLocale(raw));
  const ctx = await requirePermission("visitor:read");
  const home = await getResidence(ctx, residenceId);
  if (!home) notFound();
  const query = await searchParams;
  const today = todayInAlgiers();
  const day = isDay(query.day) ? query.day : today;
  const code = typeof query.code === "string" ? query.code : "";
  const { passes, units } = await listVisitors(ctx, residenceId, { day, code });
  const editable = can(ctx, "visitor:update");
  const t = await getTranslations("visitors");
  const tr = await getTranslations("residences");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={home.name}
        description={home.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
        actions={
          editable && day === today ? (
            <LogVisitorDialog residenceId={residenceId} units={units} />
          ) : null
        }
      />
      <ResidenceNav residenceId={residenceId} current="visitors" roles={accessOf(ctx)} />
      <p className="text-sm text-muted-foreground">{t("description")}</p>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">{t("fields.day")}</span>
          <Input type="date" name="day" defaultValue={day} dir="ltr" className="w-44" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">{t("fields.code")}</span>
          <Input
            name="code"
            defaultValue={code}
            dir="ltr"
            className="w-32 uppercase"
            autoComplete="off"
          />
        </label>
        <Button type="submit" variant="outline">
          {t("search")}
        </Button>
      </form>

      <Card>
        <CardContent>
          <div className="mb-2 text-sm font-medium">{t("dayTitle", { date: formatDate(day) })}</div>
          {passes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="visitors">
              {passes.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  data-status={p.status}
                  data-code={p.code ?? undefined}
                >
                  <div>
                    <div className="font-medium">
                      {p.visitorName}
                      {p.people > 1 ? ` (${p.people})` : ""}
                      {p.code ? (
                        <bdi dir="ltr" className="ms-2 font-mono text-muted-foreground">
                          {p.code}
                        </bdi>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground">
                      {p.unitCode ? (
                        <>
                          <bdi dir="ltr">{p.unitCode}</bdi> ·{" "}
                        </>
                      ) : null}
                      {p.hostName}
                      {p.note ? ` · ${p.note}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusClass[p.status]}>
                      {p.status === "arrived" && p.arrivedAt
                        ? t("arrivedAt", { time: timeOf(p.arrivedAt) })
                        : t(`status.${p.status}`)}
                    </Badge>
                    {editable && p.status === "expected" && day === today ? (
                      <ArrivalButton passId={p.id} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
