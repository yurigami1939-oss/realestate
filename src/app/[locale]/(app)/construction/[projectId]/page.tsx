import { Building2, CheckCircle2, Circle, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { BuildingProgressBar } from "@/components/construction/building-progress";
import { ReportCard } from "@/components/construction/report-card";
import { ReportDialog } from "@/components/construction/report-dialog";
import { ValidateMilestoneDialog } from "@/components/construction/validate-milestone-dialog";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { PastDeliveriesDialog } from "@/components/handovers/handover-dialogs";
import { ProjectStatusBadge } from "@/components/inventory/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { deleteReportAction } from "@/server/construction/actions";
import { getProjectConstruction } from "@/server/construction/queries";
import { listPastDeliveryUnits } from "@/server/handovers/queries";
import { getSalesSettings } from "@/server/organizations/settings";

/** Reports shown before « show all ». */
const RECENT_REPORTS = 10;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/construction/[projectId]">): Promise<Metadata> {
  const ctx = await requirePermission("construction:read");
  const project = await getProjectConstruction(ctx, (await params).projectId, { limit: 1 });
  return { title: project?.name };
}

/** Construction follow-up of a project: buildings' progress, milestones and progress reports. */
export default async function ProjectConstructionPage({
  params,
  searchParams,
}: PageProps<"/[locale]/construction/[projectId]">) {
  const { locale: raw, projectId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("construction:read");
  const showAll = (await searchParams).all === "1";
  const project = await getProjectConstruction(ctx, projectId, {
    limit: showAll ? undefined : RECENT_REPORTS,
  });
  if (!project) notFound();
  const editable = can(ctx.roles, "construction:update");
  const today = todayInAlgiers();
  const validation = can(ctx.roles, "milestone:validate")
    ? { delayDays: (await getSalesSettings(ctx)).paymentCallDelayDays }
    : null;
  // Units sold and handed over before the app, in a delivered project.
  const pastUnits =
    project.status === "delivered" && can(ctx.roles, "handover:update")
      ? await listPastDeliveryUnits(ctx, project.id)
      : [];
  const t = await getTranslations("construction");
  const tc = await getTranslations("common");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={project.name}
        description={t("projectDescription")}
        crumbs={[{ label: t("title"), href: "/construction" }]}
        badge={<ProjectStatusBadge status={project.status} />}
        actions={
          <>
            {can(ctx.roles, "inventory:read") ? (
              <Button asChild variant="outline">
                <Link href={`/projects/${project.id}`}>
                  <Building2 data-icon="inline-start" />
                  {t("projectSheet")}
                </Link>
              </Button>
            ) : null}
            {pastUnits.length > 0 ? (
              <PastDeliveriesDialog projectId={project.id} units={pastUnits} />
            ) : null}
            {editable ? (
              <ReportDialog projectId={project.id} buildings={project.buildings} today={today} />
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="min-w-0 space-y-4 lg:col-span-2" data-testid="construction-reports">
          <h2 className="text-lg font-semibold">{t("reports")}</h2>
          {project.reports.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              {t("noReports")}
            </p>
          ) : (
            project.reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                variant="staff"
                locale={locale}
                editable={editable}
                actions={
                  editable ? (
                    <>
                      <ReportDialog
                        projectId={project.id}
                        buildings={project.buildings}
                        today={today}
                        report={report}
                      />
                      <ConfirmAction
                        action={deleteReportAction}
                        input={{ reportId: report.id }}
                        label={tc("delete")}
                        icon={<Trash2 data-icon="inline-start" />}
                        title={t("report.deleteTitle", { title: report.title })}
                        description={t("report.deleteDescription")}
                        confirmLabel={tc("delete")}
                        successMessage={t("report.deleted")}
                        variant="ghost"
                        destructive
                      />
                    </>
                  ) : null
                }
              />
            ))
          )}
          {!showAll && project.totalReports > project.reports.length ? (
            <Link href={`/construction/${project.id}?all=1`} className="text-sm hover:underline">
              {t("showAll", { count: project.totalReports })}
            </Link>
          ) : null}
        </section>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("buildings")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4" data-testid="building-progress">
              {project.buildings.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noBuildings")}</p>
              ) : (
                project.buildings.map((b) => (
                  <BuildingProgressBar key={b.id} name={b.name} progress={b.progress} />
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("milestones")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("milestonesHint")}</p>
            </CardHeader>
            <CardContent>
              {project.milestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noMilestones")}</p>
              ) : (
                <ol className="space-y-3 text-sm" data-testid="construction-milestones">
                  {project.milestones.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        {m.validatedOn ? (
                          <CheckCircle2
                            className="mt-0.5 size-4 shrink-0 text-emerald-600"
                            aria-hidden
                          />
                        ) : (
                          <Circle
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        )}
                        <div>
                          <div className="font-medium">{m.name}</div>
                          <div className="text-muted-foreground">
                            {m.validatedOn
                              ? t("milestoneDone", { date: formatDate(m.validatedOn) })
                              : m.plannedOn
                                ? t("milestonePlanned", { date: formatDate(m.plannedOn) })
                                : t("milestoneNotPlanned")}
                          </div>
                        </div>
                      </div>
                      {validation && !m.validatedOn ? (
                        <ValidateMilestoneDialog
                          milestoneId={m.id}
                          name={m.name}
                          today={today}
                          delayDays={validation.delayDays}
                        />
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
