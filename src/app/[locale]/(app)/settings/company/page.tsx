import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { HousingAidForm } from "@/components/housing-aid/housing-aid-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { formatPercentInput, toDecimalString } from "@/lib/money";
import { requirePermission } from "@/server/auth/page-guard";
import { getHousingAidSettings } from "@/server/housing-aid/service";
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
  const aid = await getHousingAidSettings(ctx);
  const t = await getTranslations("company");
  const th = await getTranslations("housingAid");
  const amount = (v: bigint) => toDecimalString(v).replace(".", ",");
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
          formalNoticeDays: String(settings.formalNoticeDays),
          formalNoticesRequired: String(settings.formalNoticesRequired),
          terminationRetention: formatPercentInput(settings.terminationRetentionBp),
          fgcmpiNumber: settings.fgcmpiNumber ?? "",
          emailDocuments: settings.emailDocuments,
          vspLimitSigning: limit(settings.vspLimits.signing),
          vspLimitFoundations: limit(settings.vspLimits.foundations),
          vspLimitStructure: limit(settings.vspLimits.structure),
          vspLimitCompletion: limit(settings.vspLimits.completion),
        }}
      />
      <Card data-testid="housing-aid">
        <CardHeader>
          <CardTitle className="text-base">{th("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <HousingAidForm
            defaultValues={{
              snmg: aid.snmg === null ? "" : amount(aid.snmg),
              lpaMaxMultiple:
                aid.lpaMaxMultiple === null ? "" : formatPercentInput(aid.lpaMaxMultiple),
              cnlBrackets: aid.cnlBrackets.map((b) => ({
                maxMultiple: formatPercentInput(b.maxMultiple),
                amount: amount(b.amount),
              })),
              rateBrackets: aid.rateBrackets.map((b) => ({
                maxMultiple: formatPercentInput(b.maxMultiple),
                rate: formatPercentInput(b.rateBp),
              })),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
