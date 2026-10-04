import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { yearInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/page-guard";
import { getBudgetReport } from "@/server/charges/report";

import { ResidenceNav } from "../_components/residence-nav";

/** `?year=2027` → 2027; anything else → the current Algiers year. */
function parseYear(raw: string | string[] | undefined): number {
  const value = Number(typeof raw === "string" ? raw : NaN);
  return Number.isInteger(value) && value >= 2000 && value <= 2100
    ? value
    : yearInAlgiers(new Date());
}

/** Share of the budget spent, in whole percents (null without budget). */
function consumed(spent: bigint, budget: bigint): number | null {
  if (budget <= 0n) return null;
  return Number((spent * 100n) / budget);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("residences.tabs");
  return { title: t("report") };
}

export default async function ResidenceReportPage({
  params,
  searchParams,
}: PageProps<"/[locale]/residences/[residenceId]/report">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("charge:read");
  const year = parseYear((await searchParams).year);
  const report = await getBudgetReport(ctx, residenceId, year);
  if (!report) notFound();
  const t = await getTranslations("charges.report");
  const tb = await getTranslations("charges.budget");
  const tr = await getTranslations("residences");
  const moneyLocale = (await getLocale()) === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, moneyLocale);
  const yearHref = (y: number) => `/residences/${residenceId}/report?year=${y}`;
  const reserveTiles = [
    { key: "called", value: report.reserve.called },
    { key: "collected", value: report.reserve.collected },
    { key: "spent", value: report.reserve.spent },
    { key: "balance", value: report.reserve.balance },
  ] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={report.residence.name}
        description={report.residence.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
      />
      <ResidenceNav residenceId={residenceId} current="report" roles={ctx.roles} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {t("title", { year })}
            {report.budgetStatus ? (
              <Badge variant={report.budgetStatus === "approved" ? "default" : "secondary"}>
                {tb(`status.${report.budgetStatus}`)}
              </Badge>
            ) : null}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={yearHref(year - 1)}>
                <ChevronLeft data-icon="inline-start" className="rtl:rotate-180" />
                {year - 1}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={yearHref(year + 1)}>
                {year + 1}
                <ChevronRight data-icon="inline-end" className="rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          {report.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table data-testid="budget-report">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.category")}</TableHead>
                    <TableHead className="text-end">{t("columns.budget")}</TableHead>
                    <TableHead className="text-end">{t("columns.called")}</TableHead>
                    <TableHead className="text-end">{t("columns.spent")}</TableHead>
                    <TableHead className="text-end">{t("columns.paid")}</TableHead>
                    <TableHead className="text-end">{t("columns.variance")}</TableHead>
                    <TableHead className="text-end">{t("columns.consumed")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lines.map((l) => {
                    const share = consumed(l.spent, l.budget);
                    return (
                      <TableRow key={l.categoryId}>
                        <TableCell className="font-medium whitespace-normal">{l.name}</TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(l.budget)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(l.called)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(l.spent)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(l.paid)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-end tabular-nums",
                            l.variance < 0n && "font-medium text-red-700",
                          )}
                          dir="ltr"
                        >
                          {money(l.variance)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {share === null ? "—" : `${share}\u00a0%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>{t("columns.total")}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(report.totals.budget)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(report.totals.called)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(report.totals.spent)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(report.totals.paid)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(report.totals.variance)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("reserve.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <dl className="grid gap-2 text-sm sm:grid-cols-4" data-testid="reserve-fund">
            {reserveTiles.map((tile) => (
              <div key={tile.key} className="rounded-md border p-2">
                <dt className="text-muted-foreground">{t(`reserve.${tile.key}`)}</dt>
                <dd
                  className={cn(
                    "font-medium tabular-nums",
                    tile.key === "balance" && tile.value < 0n && "text-red-700",
                  )}
                >
                  <bdi dir="ltr">{money(tile.value)}</bdi>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">{t("reserve.hint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
