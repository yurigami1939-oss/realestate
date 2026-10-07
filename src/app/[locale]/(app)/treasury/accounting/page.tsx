import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountingCodesForm } from "@/components/accounting/accounting-codes-form";
import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
import { LedgerFilters } from "@/components/treasury/ledger-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { requirePermission } from "@/server/auth/page-guard";
import { getAccountingEntries, getAccountingSetup } from "@/server/accounting/service";
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
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requirePermission("treasury:update");
  const filters = ledgerParams.parse(await searchParams);
  const to = filters.to ?? todayInAlgiers();
  const from = filters.from ?? `${to.slice(0, 7)}-01`;
  const setup = await getAccountingSetup(ctx);
  const { g50 } = await getAccountingEntries(ctx, { from, to });
  const money = (v: bigint) => formatDZD(v, locale);
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
          <CardTitle className="text-base">{t("g50.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("g50.help")}</p>
          <div className="overflow-x-auto rounded-lg border">
            <Table data-testid="g50">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("g50.columns.item")}</TableHead>
                  <TableHead className="text-end">{t("g50.columns.ht")}</TableHead>
                  <TableHead className="text-end">{t("g50.columns.vat")}</TableHead>
                  <TableHead className="text-end">{t("g50.columns.ttc")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["sales", "rents", "charges"] as const).map((nature) => (
                  <TableRow key={nature}>
                    <TableCell className="whitespace-normal">{t(`g50.${nature}`)}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(g50[nature].ht)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(g50[nature].vat)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(g50[nature].ttc)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell>{t("g50.vat")}</TableCell>
                  <TableCell />
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(g50.vat)}
                  </TableCell>
                  <TableCell />
                </TableRow>
                <TableRow>
                  <TableCell>{t("g50.cash")}</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(g50.cash)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t("g50.stampDuty", { rate: g50.stampDutyBp / 100 })}</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(g50.stampDuty)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">{t("g50.note")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("chart")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountingCodesForm codes={setup.codes} tax={setup.tax} accounts={setup.accounts} />
        </CardContent>
      </Card>
    </div>
  );
}
