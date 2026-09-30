import { Plus, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { deleteBuildingAction } from "@/server/inventory/actions";
import { getBuildingGrid } from "@/server/inventory/queries";

import { BuildingDialog } from "../../_components/building-dialog";

import { GenerateUnitsDialog } from "./_components/generate-units-dialog";
import { UnitGrid } from "./_components/unit-grid";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory.grid");
  return { title: t("title") };
}

export default async function BuildingPage({
  params,
}: PageProps<"/[locale]/projects/[projectId]/buildings/[buildingId]">) {
  const { locale, projectId, buildingId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("inventory:read");
  const grid = await getBuildingGrid(ctx, buildingId);
  if (!grid || grid.projectId !== projectId) notFound();

  const t = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const building = {
    id: grid.id,
    code: grid.code,
    name: grid.name,
    lowestFloor: grid.lowestFloor,
    topFloor: grid.topFloor,
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={grid.name}
        description={t("grid.title")}
        crumbs={[
          { label: t("projects.title"), href: "/projects" },
          { label: grid.projectName, href: `/projects/${projectId}` },
        ]}
        actions={
          <>
            {can(ctx.roles, "unit:create") ? (
              <>
                <GenerateUnitsDialog building={building} />
                <Button asChild>
                  <Link href={`/projects/${projectId}/units/new?building=${grid.id}`}>
                    <Plus data-icon="inline-start" />
                    {t("units.new")}
                  </Link>
                </Button>
              </>
            ) : null}
            {can(ctx.roles, "project:update") ? (
              <>
                <BuildingDialog projectId={projectId} building={building} />
                {grid.units.length === 0 ? (
                  <ConfirmAction
                    action={deleteBuildingAction}
                    input={{ buildingId: grid.id }}
                    label={tc("delete")}
                    icon={<Trash2 data-icon="inline-start" />}
                    title={t("buildings.deleteTitle", { name: grid.name })}
                    description={t("buildings.deleteDescription")}
                    confirmLabel={tc("delete")}
                    successMessage={t("buildings.deleted")}
                    redirectTo={`/projects/${projectId}`}
                    destructive
                  />
                ) : null}
              </>
            ) : null}
          </>
        }
      />
      <UnitGrid
        projectId={projectId}
        units={grid.units}
        lowestFloor={grid.lowestFloor}
        topFloor={grid.topFloor}
      />
    </div>
  );
}
