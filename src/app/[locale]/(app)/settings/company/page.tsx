import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { formatPercentInput } from "@/lib/money";
import { requirePermission } from "@/server/auth/page-guard";
import { getCompanySettings } from "@/server/organizations/settings";

import { CompanyForm } from "./_components/company-form";
import { CompanyLogo } from "./_components/company-logo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("company");
  return { title: t("title") };
}

export default async function CompanyPage({ params }: PageProps<"/[locale]/settings/company">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("organization:update");
  const settings = await getCompanySettings(ctx);
  const t = await getTranslations("company");
  const limit = (bp: number | undefined) => (bp === undefined ? "" : formatPercentInput(bp));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <CompanyLogo orgId={ctx.orgId} logoFileId={settings.logoFileId} />
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
          optionHours: String(settings.optionHours),
          paymentCallDelayDays: String(settings.paymentCallDelayDays),
          withdrawalRetention: formatPercentInput(settings.withdrawalRetentionBp),
          penaltyMonthlyRate: formatPercentInput(settings.penaltyMonthlyRateBp),
          penaltyGraceDays: String(settings.penaltyGraceDays),
          penaltyCap: formatPercentInput(settings.penaltyCapBp),
          defaultCommissionRate: formatPercentInput(settings.defaultCommissionRateBp),
          deliveryPenaltyMonthlyRate: formatPercentInput(settings.deliveryPenaltyMonthlyRateBp),
          deliveryPenaltyCap: formatPercentInput(settings.deliveryPenaltyCapBp),
          fgcmpiNumber: settings.fgcmpiNumber ?? "",
          vspLimitSigning: limit(settings.vspLimits.signing),
          vspLimitFoundations: limit(settings.vspLimits.foundations),
          vspLimitStructure: limit(settings.vspLimits.structure),
          vspLimitCompletion: limit(settings.vspLimits.completion),
        }}
      />
    </div>
  );
}
