import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { BuildingProgressBar } from "@/components/construction/building-progress";
import { ProjectStatusBadge } from "@/components/inventory/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate } from "@/lib/dates";
import { requirePermission } from "@/server/auth/page-guard";
import { listConstructionOverview } from "@/server/construction/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("construction");
  return { title: t("title") };
}

/** Construction overview: every project with its buildings' progress and next milestone. */
export default async function ConstructionPage({ params }: PageProps<"/[locale]/construction">) {
  const { locale } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("construction:read");
  const projects = await listConstructionOverview(ctx);
  const t = await getTranslations("construction");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("noProjects")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2" data-testid="construction-projects">
          {projects.map((p) => (
            <Card key={p.id} data-project={p.code}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <CardTitle className="text-base">
                  <Link href={`/construction/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                </CardTitle>
                <ProjectStatusBadge status={p.status} />
              </CardHeader>
              <CardContent className="space-y-4">
                {p.buildings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noBuildings")}</p>
                ) : (
                  <div className="space-y-3">
                    {p.buildings.map((b) => (
                      <BuildingProgressBar key={b.id} name={b.name} progress={b.progress} />
                    ))}
                  </div>
                )}
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t("overview.reports")}</dt>
                    <dd>
                      {p.lastReportOn
                        ? t("overview.lastReport", {
                            count: p.reports,
                            date: formatDate(p.lastReportOn),
                          })
                        : t("overview.noReport")}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t("overview.milestones")}</dt>
                    <dd>
                      {t("overview.milestonesDone", {
                        done: p.milestonesDone,
                        total: p.milestones,
                      })}
                    </dd>
                  </div>
                  {p.nextMilestone ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t("overview.next")}</dt>
                      <dd className="text-end">
                        {p.nextMilestone.name}
                        {p.nextMilestone.plannedOn
                          ? ` · ${t("overview.plannedOn", { date: formatDate(p.nextMilestone.plannedOn) })}`
                          : ""}
                      </dd>
                    </div>
                  ) : null}
                  {p.plannedDeliveryOn ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t("overview.delivery")}</dt>
                      <dd>{formatDate(p.plannedDeliveryOn)}</dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
