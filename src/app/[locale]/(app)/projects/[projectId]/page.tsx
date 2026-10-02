import { CalendarRange, Grid3x3, Pencil, Tags, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ProjectStatusBadge, StatsBar } from "@/components/inventory/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { deleteProjectAction } from "@/server/inventory/actions";
import { getProject, type ProjectDetail } from "@/server/inventory/queries";

import { BuildingDialog } from "./_components/building-dialog";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/projects/[projectId]">): Promise<Metadata> {
  const ctx = await requirePermission("inventory:read");
  const project = await getProject(ctx, (await params).projectId);
  return { title: project?.name };
}

export default async function ProjectPage({ params }: PageProps<"/[locale]/projects/[projectId]">) {
  const { locale, projectId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("inventory:read");
  const project = await getProject(ctx, projectId);
  if (!project) notFound();

  const t = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const tp = await getTranslations("paymentPlans");
  const canEdit = can(ctx.roles, "project:update");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={project.name}
        crumbs={[{ label: t("projects.title"), href: "/projects" }]}
        badge={
          <>
            <Badge variant="secondary" dir="ltr">
              {project.code}
            </Badge>
            <ProjectStatusBadge status={project.status} />
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/projects/${project.id}/price-lists`}>
                <Tags data-icon="inline-start" />
                {t("priceLists.title")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/projects/${project.id}/payment-plans`}>
                <CalendarRange data-icon="inline-start" />
                {tp("title")}
              </Link>
            </Button>
            {canEdit ? (
              <Button asChild variant="outline">
                <Link href={`/projects/${project.id}/edit`}>
                  <Pencil data-icon="inline-start" />
                  {t("projects.editTitle")}
                </Link>
              </Button>
            ) : null}
            {can(ctx.roles, "project:delete") && project.totals.units === 0 ? (
              <ConfirmAction
                action={deleteProjectAction}
                input={{ projectId: project.id }}
                label={tc("delete")}
                icon={<Trash2 data-icon="inline-start" />}
                title={t("projects.deleteTitle", { name: project.name })}
                description={t("projects.deleteDescription")}
                confirmLabel={tc("delete")}
                successMessage={t("projects.deleted")}
                redirectTo="/projects"
                destructive
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <ProjectInfo project={project} />
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <StatsBar stats={project.totals} />
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("buildings.title")}</h2>
          {canEdit ? <BuildingDialog projectId={project.id} /> : null}
        </div>
        {project.buildings.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            {t("buildings.empty")}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2" data-testid="building-list">
            {project.buildings.map((b) => (
              <Card key={b.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{b.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {t("buildings.floors", { count: b.topFloor - b.lowestFloor + 1 })}
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link href={`/projects/${project.id}/buildings/${b.id}`}>
                      <Grid3x3 data-icon="inline-start" />
                      {t("buildings.openGrid")}
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  <StatsBar stats={b} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProjectInfo({ project }: { project: ProjectDetail }) {
  const t = useTranslations("inventory.projects");
  const rows: [string, string | null][] = [
    [
      t("fields.address"),
      [project.address, project.commune, project.wilaya].filter(Boolean).join(", ") || null,
    ],
    [
      t("fields.buildingPermitNumber"),
      project.buildingPermitNumber
        ? `${project.buildingPermitNumber}${project.buildingPermitDate ? ` · ${formatDate(project.buildingPermitDate)}` : ""}`
        : null,
    ],
    [t("fields.launchedOn"), project.launchedOn ? formatDate(project.launchedOn) : null],
    [
      t("fields.plannedDeliveryOn"),
      project.plannedDeliveryOn ? formatDate(project.plannedDeliveryOn) : null,
    ],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("information")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-2 gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {project.description ? (
          <p className="whitespace-pre-line text-muted-foreground">{project.description}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
