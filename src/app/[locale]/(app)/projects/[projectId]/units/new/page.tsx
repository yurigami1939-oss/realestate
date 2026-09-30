import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { requirePermission } from "@/server/auth/page-guard";
import { getProject, listBuildings } from "@/server/inventory/queries";

import { UnitForm } from "../_components/unit-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory.units");
  return { title: t("new") };
}

export default async function NewUnitPage({
  params,
  searchParams,
}: PageProps<"/[locale]/projects/[projectId]/units/new">) {
  const { locale, projectId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("unit:create");
  const [project, buildings] = await Promise.all([
    getProject(ctx, projectId),
    listBuildings(ctx, projectId),
  ]);
  if (!project || buildings.length === 0) notFound();

  const requested = (await searchParams).building;
  const building = buildings.find((b) => b.id === requested) ?? buildings[0];
  const t = await getTranslations("inventory");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("units.new")}
        crumbs={[
          { label: t("projects.title"), href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          ...(building
            ? [{ label: building.name, href: `/projects/${project.id}/buildings/${building.id}` }]
            : []),
        ]}
      />
      <UnitForm
        projectId={project.id}
        buildings={buildings}
        defaultValues={{
          buildingId: building?.id ?? "",
          code: "",
          floor: String(Math.max(building?.lowestFloor ?? 0, 0)),
          type: "apartment",
          typology: "",
          isDuplex: false,
          livingArea: "",
          usableArea: "",
          outdoorArea: "",
          orientations: [],
          share: "",
          notes: "",
        }}
      />
    </div>
  );
}
