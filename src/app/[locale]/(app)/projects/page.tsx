import { MapPin, Plus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ProjectStatusBadge, StatsBar } from "@/components/inventory/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listProjects, type ProjectListItem } from "@/server/inventory/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory.projects");
  return { title: t("title") };
}

export default async function ProjectsPage({ params }: PageProps<"/[locale]/projects">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("inventory:read");
  const t = await getTranslations("inventory.projects");
  const projects = await listProjects(ctx);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(ctx.roles, "project:create") ? (
            <Button asChild>
              <Link href="/projects/new">
                <Plus data-icon="inline-start" />
                {t("new")}
              </Link>
            </Button>
          ) : null
        }
      />
      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="project-list">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectListItem }) {
  const location = [project.commune, project.wilaya].filter(Boolean).join(", ");
  return (
    <Link href={`/projects/${project.id}`} className="group rounded-xl focus-visible:outline-2">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base">{project.name}</CardTitle>
            <Badge variant="secondary" dir="ltr">
              {project.code}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ProjectStatusBadge status={project.status} />
            {location ? (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {location}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <StatsBar stats={project} />
        </CardContent>
      </Card>
    </Link>
  );
}
