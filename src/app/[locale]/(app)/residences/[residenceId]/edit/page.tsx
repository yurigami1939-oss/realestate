import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { formatPercentInput } from "@/lib/money";
import { requirePermission } from "@/server/auth/page-guard";
import { getResidence } from "@/server/residences/queries";

import { ResidenceForm } from "../../_components/residence-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("residences");
  return { title: t("editTitle") };
}

export default async function EditResidencePage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/edit">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("residence:update");
  const residence = await getResidence(ctx, residenceId);
  if (!residence) notFound();
  const t = await getTranslations("residences");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("editTitle")}
        crumbs={[
          { label: t("title"), href: "/residences" },
          { label: residence.name, href: `/residences/${residence.id}` },
        ]}
      />
      <ResidenceForm
        residenceId={residence.id}
        projects={[]}
        defaultValues={{
          projectId: residence.projectId,
          name: residence.name,
          address: residence.address ?? "",
          commune: residence.commune ?? "",
          wilaya: residence.wilaya ?? "",
          shareBasis: String(residence.shareBasis),
          chargeFrequency: residence.chargeFrequency,
          reserveFund: formatPercentInput(residence.reserveFundBp),
          callDueDays: String(residence.callDueDays),
          notes: residence.notes ?? "",
        }}
      />
    </div>
  );
}
