import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountingCodesForm } from "@/components/accounting/accounting-codes-form";
import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
import { LedgerFilters } from "@/components/treasury/ledger-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { requirePermission } from "@/server/auth/page-guard";
import { getAccountingSetup } from "@/server/accounting/service";
import { ledgerParams } from "@/server/treasury/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounting");
  return { title: t("title") };
}

/**
 * Export comptable: the journal entries of a period (every treasury account's flows) as an
 * Excel file for the chartered accountant, and the chart's codes they are written with.
 */
export default async function AccountingPage({
  params,
  searchParams,
}: PageProps<"/[locale]/treasury/accounting">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("treasury:update");
  const filters = ledgerParams.parse(await searchParams);
  const to = filters.to ?? todayInAlgiers();
  const from = filters.from ?? `${to.slice(0, 7)}-01`;
  const setup = await getAccountingSetup(ctx);
  const t = await getTranslations("accounting");
  const tt = await getTranslations("treasury");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        crumbs={[{ label: tt("title"), href: "/treasury" }]}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("export")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LedgerFilters from={from} to={to} />
          <ExportButton kind="accounting" params={{ from, to }} label={t("download")} />
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("chart")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountingCodesForm codes={setup.codes} accounts={setup.accounts} />
        </CardContent>
      </Card>
    </div>
  );
}
