import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
import { ReportFilters } from "@/components/reports/report-filters";
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
import { toLocale } from "@/i18n/locales";
import { formatDZD } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { ageingBuckets } from "@/lib/reports";
import { requirePermission } from "@/server/auth/page-guard";
import { getReports } from "@/server/reports/queries";
import { reportParams } from "@/server/reports/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");
  return { title: t("title") };
}

function Amount({ value, locale }: { value: bigint; locale: "fr" | "ar" }) {
  return (
    <TableCell className="text-end tabular-nums" dir="ltr">
      {formatDZD(value, locale)}
    </TableCell>
  );
}

/**
 * Management reports (CLAUDE.md §7 Reports): sales and collections by month, sales by project
 * and typology, commercial performance, receivables by age, collections expected, stock.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/reports">) {
  const { locale: raw } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("report:read");
  const filters = reportParams.parse(await searchParams);
  const r = await getReports(ctx, filters);
  const t = await getTranslations("reports");
  const ti = await getTranslations("inventory");
  const money = (v: bigint) => formatDZD(v, locale);
  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${month}-01T00:00:00Z`));
  const typologyLabel = (value: string) =>
    /^F\d$/.test(value) ? value : ti(`unitType.${value as "apartment"}`);
  const ageingTotal = ageingBuckets.reduce((sum, b) => sum + r.ageing[b], 0n);

  const tiles: { key: "reserved" | "sold" | "collected"; count?: number; value: bigint }[] = [
    { key: "reserved", count: r.totals.reservations, value: r.totals.reserved },
    { key: "sold", count: r.totals.sales, value: r.totals.sold },
    { key: "collected", value: r.totals.collected },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <ExportButton
            kind="report"
            params={{ from: r.from, to: r.to, project: r.projectId ?? undefined }}
          />
        }
      />
      <ReportFilters from={r.from} to={r.to} project={r.projectId} projects={r.projects} />

      <dl
        className="grid gap-4 rounded-lg border p-4 text-sm sm:grid-cols-3"
        data-testid="report-totals"
      >
        {tiles.map((tile) => (
          <div key={tile.key}>
            <dt className="text-muted-foreground">
              {t(`totals.${tile.key}`)}
              {tile.count !== undefined ? ` · ${tile.count}` : ""}
            </dt>
            <dd className="text-lg font-semibold tabular-nums" dir="ltr">
              {money(tile.value)}
            </dd>
          </div>
        ))}
      </dl>
      {r.totals.withdrawn > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("totals.withdrawn", { count: r.totals.withdrawn })}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("byMonth.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table data-testid="report-by-month">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.month")}</TableHead>
                <TableHead className="text-end">{t("columns.reservations")}</TableHead>
                <TableHead className="text-end">{t("columns.reserved")}</TableHead>
                <TableHead className="text-end">{t("columns.sales")}</TableHead>
                <TableHead className="text-end">{t("columns.sold")}</TableHead>
                <TableHead className="text-end">{t("columns.collected")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.byMonth.map((m) => (
                <TableRow key={m.month}>
                  <TableCell>{monthLabel(m.month)}</TableCell>
                  <TableCell className="text-end tabular-nums">{m.reservations}</TableCell>
                  <Amount value={m.reserved} locale={locale} />
                  <TableCell className="text-end tabular-nums">{m.sales}</TableCell>
                  <Amount value={m.sold} locale={locale} />
                  <Amount value={m.collected} locale={locale} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("byTypology.title")}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {r.byTypology.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <Table data-testid="report-by-typology">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.project")}</TableHead>
                    <TableHead>{t("columns.typology")}</TableHead>
                    <TableHead className="text-end">{t("columns.count")}</TableHead>
                    <TableHead className="text-end">{t("columns.value")}</TableHead>
                    <TableHead className="text-end">{t("columns.perSquareMeter")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.byTypology.map((g) => (
                    <TableRow key={`${g.projectName}-${g.typology}`}>
                      <TableCell className="whitespace-normal">{g.projectName}</TableCell>
                      <TableCell>{typologyLabel(g.typology)}</TableCell>
                      <TableCell className="text-end tabular-nums">{g.count}</TableCell>
                      <Amount value={g.value} locale={locale} />
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {g.perSquareMeter === null ? "—" : money(g.perSquareMeter)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("commercials.title")}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {r.commercials.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <Table data-testid="report-commercials">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.commercial")}</TableHead>
                    <TableHead className="text-end">{t("columns.leads")}</TableHead>
                    <TableHead className="text-end">{t("columns.reservations")}</TableHead>
                    <TableHead className="text-end">{t("columns.conversion")}</TableHead>
                    <TableHead className="text-end">{t("columns.reserved")}</TableHead>
                    <TableHead className="text-end">{t("columns.collected")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.commercials.map((c) => (
                    <TableRow key={c.userId}>
                      <TableCell className="whitespace-normal">{c.name}</TableCell>
                      <TableCell className="text-end tabular-nums">{c.leads}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {c.reservations}
                        {c.sales > 0 ? (
                          <span className="block text-xs text-muted-foreground">
                            {t("commercials.vsp", { count: c.sales })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {c.conversionBp === null ? "—" : formatShare(c.conversionBp)}
                      </TableCell>
                      <Amount value={c.reserved} locale={locale} />
                      <Amount value={c.collected} locale={locale} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ageing.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("ageing.description")}</p>
          </CardHeader>
          <CardContent>
            <Table data-testid="report-ageing">
              <TableBody>
                {ageingBuckets.map((b) => (
                  <TableRow key={b} data-bucket={b}>
                    <TableCell>{t(`ageing.${b}`)}</TableCell>
                    <Amount value={r.ageing[b]} locale={locale} />
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{t("columns.total")}</TableCell>
                  <Amount value={ageingTotal} locale={locale} />
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("forecast.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("forecast.description")}</p>
          </CardHeader>
          <CardContent>
            <Table data-testid="report-forecast">
              <TableBody>
                {r.forecast.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{monthLabel(m.month)}</TableCell>
                    <Amount value={m.expected} locale={locale} />
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="text-muted-foreground">{t("forecast.later")}</TableCell>
                  <Amount value={r.forecastLater} locale={locale} />
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("stock.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table data-testid="report-stock">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.project")}</TableHead>
                <TableHead>{t("columns.typology")}</TableHead>
                <TableHead className="text-end">{t("stock.available")}</TableHead>
                <TableHead className="text-end">{t("stock.optioned")}</TableHead>
                <TableHead className="text-end">{t("stock.reserved")}</TableHead>
                <TableHead className="text-end">{t("stock.sold")}</TableHead>
                <TableHead className="text-end">{t("stock.value")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.stock.map((s) => (
                <TableRow key={`${s.projectName}-${s.typology}`}>
                  <TableCell className="whitespace-normal">{s.projectName}</TableCell>
                  <TableCell>{typologyLabel(s.typology)}</TableCell>
                  <TableCell className="text-end tabular-nums">{s.available}</TableCell>
                  <TableCell className="text-end tabular-nums">{s.optioned}</TableCell>
                  <TableCell className="text-end tabular-nums">{s.reserved}</TableCell>
                  <TableCell className="text-end tabular-nums">{s.sold}</TableCell>
                  <Amount value={s.value} locale={locale} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
