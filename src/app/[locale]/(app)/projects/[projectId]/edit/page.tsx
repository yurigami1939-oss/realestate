import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { requirePermission } from "@/server/auth/page-guard";
import { getProject } from "@/server/inventory/queries";

import { ProjectForm } from "../../_components/project-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory.projects");
  return { title: t("editTitle") };
}

export default async function EditProjectPage({
  params,
}: PageProps<"/[locale]/projects/[projectId]/edit">) {
  const { locale, projectId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("project:update");
  const project = await getProject(ctx, projectId);
  if (!project) notFound();
  const t = await getTranslations("inventory.projects");
  const text = (v: string | null) => v ?? "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("editTitle")}
        crumbs={[
          { label: t("title"), href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
        ]}
      />
      <ProjectForm
        projectId={project.id}
        defaultValues={{
          code: project.code,
          name: project.name,
          status: project.status,
          address: text(project.address),
          wilaya: text(project.wilaya),
          commune: text(project.commune),
          buildingPermitNumber: text(project.buildingPermitNumber),
          buildingPermitDate: text(project.buildingPermitDate),
          launchedOn: text(project.launchedOn),
          plannedDeliveryOn: text(project.plannedDeliveryOn),
          description: text(project.description),
        }}
      />
    </div>
  );
}
