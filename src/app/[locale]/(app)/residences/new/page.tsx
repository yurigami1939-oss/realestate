import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { DEFAULT_SHARE_BASIS } from "@/lib/residences";
import { requirePermission } from "@/server/auth/page-guard";
import { listProjectOptions } from "@/server/inventory/queries";

import { ResidenceForm } from "../_components/residence-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("residences");
  return { title: t("newTitle") };
}

export default async function NewResidencePage({
  params,
  searchParams,
}: PageProps<"/[locale]/residences/new">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("residence:create");
  // Third parties' buildings are set up for their residence (CLAUDE.md §7).
  const options = await listProjectOptions(ctx, { thirdParty: true });
  const t = await getTranslations("residences");
  const projects = options.map((p) => ({
    id: p.id,
    name: p.thirdParty ? t("thirdPartyOption", { name: p.name }) : p.name,
  }));
  const asked = (await searchParams).project;
  const chosen = projects.find((p) => p.id === asked) ?? projects[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("newTitle")} crumbs={[{ label: t("title"), href: "/residences" }]} />
      <ResidenceForm
        projects={projects}
        defaultValues={{
          projectId: chosen?.id ?? "",
          name: "",
          address: "",
          commune: "",
          wilaya: "",
          shareBasis: String(DEFAULT_SHARE_BASIS),
          chargeFrequency: "quarterly",
          reserveFund: "5",
          callDueDays: "30",
          notes: "",
        }}
      />
    </div>
  );
}
