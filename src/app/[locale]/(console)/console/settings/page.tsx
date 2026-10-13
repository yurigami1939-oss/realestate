import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { OperatorLogoForm, OperatorProfileForm } from "@/components/console/billing-forms";
import { toLocale } from "@/i18n/locales";
import { formatPercentInput } from "@/lib/money";
import { getOperatorProfile } from "@/server/console/billing";
import { requireOperator } from "@/server/console/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("console.settings");
  return { title: t("title") };
}

/**
 * The operator's profile (CLAUDE.console.md §10, §11): identity, bank and RIB, VAT regime and
 * rate, payment terms, the invoices' footer and logo — snapshotted on each invoice issued.
 */
export default async function ConsoleSettingsPage({
  params,
}: PageProps<"/[locale]/console/settings">) {
  setRequestLocale(toLocale((await params).locale));
  await requireOperator();
  const profile = await getOperatorProfile();
  const t = await getTranslations("console.settings");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <section className="rounded-xl bg-card p-4 shadow-card sm:p-6">
        <OperatorProfileForm
          defaults={{
            legalName: profile?.legalName ?? "",
            brand: profile?.brand ?? "",
            legalForm: profile?.legalForm ?? "",
            address: profile?.address ?? "",
            wilaya: profile?.wilaya ?? "",
            phone: profile?.phone ?? "",
            email: profile?.email ?? "",
            rcNumber: profile?.rcNumber ?? "",
            nif: profile?.nif ?? "",
            nis: profile?.nis ?? "",
            aiNumber: profile?.aiNumber ?? "",
            bank: profile?.bank ?? "",
            rib: profile?.rib ?? "",
            vatRegime: profile?.vatRegime ?? "vat",
            vatRate: formatPercentInput(profile?.vatRateBp ?? 1900),
            paymentTermsDays: String(profile?.paymentTermsDays ?? 15),
            footerFr: profile?.footerFr ?? "",
            footerAr: profile?.footerAr ?? "",
          }}
        />
      </section>
      {profile ? (
        <section className="space-y-3 rounded-xl bg-card p-4 shadow-card sm:p-6">
          <h2 className="text-headline">{t("logo")}</h2>
          <p className="text-footnote text-muted-foreground">
            {profile.logoKey ? t("logoHint") : `${t("logoNone")} ${t("logoHint")}`}
          </p>
          <OperatorLogoForm hasLogo={profile.logoKey !== null} />
        </section>
      ) : null}
    </div>
  );
}
