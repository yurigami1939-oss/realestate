import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PortalDocument } from "@/components/portal/portal-document";
import { Badge } from "@/components/ui/badge";
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
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getPortalCouncil } from "@/server/portal/council";
import { requirePortalCtx } from "@/server/portal/page-guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.council");
  return { title: t("title") };
}

/**
 * The residents' council reads its residence's accounts: the year's budget against actual per
 * category, the reserve fund and the supplier invoices with their scans.
 */
export default async function PortalCouncilPage({
  params,
  searchParams,
}: PageProps<"/[locale]/portal/council/[residenceId]">) {
  const { locale: raw, residenceId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePortalCtx();
  const current = Number(todayInAlgiers().slice(0, 4));
  const asked = Number((await searchParams).year);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= current ? asked : current;
  const council = await getPortalCouncil(ctx, residenceId, year);
  if (!council) notFound();
  const { report, invoices } = council;
  const t = await getTranslations("portal.council");
  const tps = await getTranslations("portal.sale");
  const money = (v: bigint) => formatDZD(v, locale);

  return (
    <div className="space-y-6">
      <Link
        href="/portal"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {tps("back")}
      </Link>
      <div className="space-y-1">
        <h1 className="text-large-title">{report.residence.name}</h1>
        <p className="text-sm text-muted-foreground">{t("description", { year })}</p>
        <nav className="flex gap-3 text-sm" aria-label={t("years")}>
          {[current - 1, current].map((y) => (
            <Link
              key={y}
              href={`/portal/council/${residenceId}?year=${y}`}
              aria-current={y === year ? "page" : undefined}
              className={cn(
                "hover:underline",
                y === year ? "font-medium" : "text-muted-foreground",
              )}
            >
              {y}
            </Link>
          ))}
        </nav>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("budget")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl bg-card shadow-card in-data-[slot=card]:border in-data-[slot=card]:shadow-none">
            <Table data-testid="council-budget">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("category")}</TableHead>
                  <TableHead className="text-end">{t("budgeted")}</TableHead>
                  <TableHead className="text-end">{t("called")}</TableHead>
                  <TableHead className="text-end">{t("spent")}</TableHead>
                  <TableHead className="text-end">{t("variance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.lines.map((line) => (
                  <TableRow key={line.categoryId}>
                    <TableCell className="whitespace-normal">{line.name}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(line.budget)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(line.called)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(line.spent)}
                    </TableCell>
                    <TableCell
                      className={cn("text-end tabular-nums", line.variance < 0n && "text-danger")}
                      dir="ltr"
                    >
                      {money(line.variance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{t("total")}</TableCell>
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
                    {money(report.totals.variance)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("reserve")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-4" data-testid="council-reserve">
            {(
              [
                ["reserveCalled", report.reserve.called],
                ["reserveCollected", report.reserve.collected],
                ["reserveSpent", report.reserve.spent],
                ["reserveBalance", report.reserve.balance],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-muted/50 px-3 py-2">
                <dt className="text-muted-foreground">{t(key)}</dt>
                <dd className="font-semibold tabular-nums" dir="ltr">
                  {money(value)}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("invoices")}</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noInvoices")}</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="council-invoices">
              {invoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div>
                    <span className="font-medium">{invoice.supplierName}</span>{" "}
                    <span className="text-muted-foreground">
                      · <bdi dir="ltr">{invoice.number}</bdi> · {formatDate(invoice.invoiceOn)} ·{" "}
                      {invoice.fromReserve ? t("fromReserve") : (invoice.categoryName ?? "—")}
                    </span>
                    <div className="text-xs text-muted-foreground">{invoice.label}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums" dir="ltr">
                      {money(invoice.amount)}
                    </span>
                    {invoice.paidOn ? (
                      <Badge variant="secondary">
                        {t("paidOn", { date: formatDate(invoice.paidOn) })}
                      </Badge>
                    ) : (
                      <Badge variant="outline">{t("unpaid")}</Badge>
                    )}
                    {invoice.scanFileId ? (
                      <PortalDocument fileId={invoice.scanFileId} label={t("scan")} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
