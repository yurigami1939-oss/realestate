import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { requirePermission } from "@/server/auth/page-guard";
import { getCompanySettings } from "@/server/organizations/settings";

import { CompanyForm } from "./_components/company-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("company");
  return { title: t("title") };
}

export default async function CompanyPage({ params }: PageProps<"/[locale]/settings/company">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("organization:update");
  const settings = await getCompanySettings(ctx);
  const t = await getTranslations("company");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <CompanyForm
        defaultValues={{
          name: settings.name,
          legalName: settings.legalName ?? "",
          address: settings.address ?? "",
          wilaya: settings.wilaya ?? "",
          phone: settings.phone ?? "",
          rcNumber: settings.rcNumber ?? "",
          nif: settings.nif ?? "",
          nis: settings.nis ?? "",
          aiNumber: settings.aiNumber ?? "",
          quotationValidityDays: String(settings.quotationValidityDays),
        }}
      />
    </div>
  );
}
