import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { requirePermission } from "@/server/auth/page-guard";
import { getUnit, listBuildings } from "@/server/inventory/queries";

import { UnitForm } from "../../_components/unit-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("edit") };
}

export default async function EditUnitPage({
  params,
}: PageProps<"/[locale]/projects/[projectId]/units/[unitId]/edit">) {
  const { locale, projectId, unitId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("unit:update");
  const [unit, buildings] = await Promise.all([
    getUnit(ctx, unitId),
    listBuildings(ctx, projectId),
  ]);
  if (!unit || unit.projectId !== projectId) notFound();
  const t = await getTranslations("inventory");
  const text = (v: string | number | null) => (v === null ? "" : String(v));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("units.editTitle", { code: unit.code })}
        crumbs={[
          { label: t("projects.title"), href: "/projects" },
          { label: unit.projectName, href: `/projects/${projectId}` },
          { label: unit.buildingName, href: `/projects/${projectId}/buildings/${unit.buildingId}` },
          { label: unit.code, href: `/projects/${projectId}/units/${unit.id}` },
        ]}
      />
      <UnitForm
        projectId={projectId}
        unitId={unit.id}
        buildings={buildings}
        defaultValues={{
          buildingId: unit.buildingId,
          code: unit.code,
          floor: String(unit.floor),
          type: unit.type,
          typology: unit.typology ?? "",
          isDuplex: unit.isDuplex,
          livingArea: text(unit.livingArea),
          usableArea: text(unit.usableArea),
          outdoorArea: text(unit.outdoorArea),
          orientations: unit.orientations,
          share: text(unit.share),
          notes: text(unit.notes),
        }}
      />
    </div>
  );
}
