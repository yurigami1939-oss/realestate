import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
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
import { leaseKinds } from "@/lib/rentals";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/page-guard";
import { rentalTaxesParams } from "@/server/rentals/schemas";
import { getRentalTaxes } from "@/server/rentals/taxes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rentals.taxes");
  return { title: t("title") };
}

/**
 * Rental taxes of a year (CLAUDE.md §7 Rentals): what fell due per lease, split into HT and VAT
 * at the organization's rates, the rent collected and the leases' registration duties — the
 * figures the accountant declares.
 */
export default async function RentalTaxesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/rentals/taxes">) {
  const { locale: raw } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("lease:read");
  const current = Number(todayInAlgiers().slice(0, 4));
  const year = rentalTaxesParams.parse(await searchParams).year ?? current;
  const taxes = await getRentalTaxes(ctx, year);
  const t = await getTranslations("rentals");
  const money = (v: bigint) => formatDZD(v, locale);
  const amount = (v: bigint) => (
    <bdi dir="ltr" className="tabular-nums">
      {money(v)}
    </bdi>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("taxes.title")}
        description={t("taxes.description", { year })}
        crumbs={[{ label: t("title"), href: "/rentals" }]}
        actions={<ExportButton kind="rent_taxes" params={{ year }} />}
      />
      <nav className="flex gap-3 text-sm" aria-label={t("taxes.years")}>
        {[current - 2, current - 1, current].map((y) => (
          <Link
            key={y}
            href={{ pathname: "/rentals/taxes", query: { year: y } }}
            aria-current={y === year ? "page" : undefined}
            className={cn("hover:underline", y === year ? "font-medium" : "text-muted-foreground")}
          >
            {y}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 sm:grid-cols-3" data-testid="rent-tax-totals">
        {leaseKinds.map((kind) => (
          <Card key={kind}>
            <CardHeader>
              <CardTitle>{t(`kind.${kind}`)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t("taxes.columns.ht")}</span>
                {amount(taxes.totals[kind].ht)}
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  {t("taxes.vatAt", { rate: taxes.rates[kind] / 100 })}
                </span>
                {amount(taxes.totals[kind].vat)}
              </div>
              <div className="flex justify-between gap-3 font-medium">
                <span>{t("taxes.columns.due")}</span>
                {amount(taxes.totals[kind].due)}
              </div>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>{t("taxes.collectedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("taxes.columns.collected")}</span>
              {amount(taxes.all.collected)}
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("taxes.columns.duty")}</span>
              {amount(taxes.all.duty)}
            </div>
          </CardContent>
        </Card>
      </div>

      {taxes.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("taxes.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card shadow-card in-data-[slot=card]:border in-data-[slot=card]:shadow-none">
          <Table data-testid="rent-taxes">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.lease")}</TableHead>
                <TableHead>{t("columns.tenant")}</TableHead>
                <TableHead className="text-end">{t("taxes.columns.due")}</TableHead>
                <TableHead className="text-end">{t("taxes.columns.ht")}</TableHead>
                <TableHead className="text-end">{t("taxes.columns.vat")}</TableHead>
                <TableHead className="text-end">{t("taxes.columns.collected")}</TableHead>
                <TableHead>{t("taxes.columns.registration")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {taxes.rows.map((r) => (
                <TableRow key={r.id} data-lease={r.number}>
                  <TableCell>
                    <Link
                      data-row-link
                      href={`/rentals/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      <bdi dir="ltr">{r.number}</bdi>
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {t(`kind.${r.kind}`)} · <bdi dir="ltr">{r.unitCode}</bdi>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">{r.tenantName}</TableCell>
                  <TableCell className="text-end">{amount(r.due)}</TableCell>
                  <TableCell className="text-end">{amount(r.ht)}</TableCell>
                  <TableCell className="text-end">{amount(r.vat)}</TableCell>
                  <TableCell className="text-end">{amount(r.collected)}</TableCell>
                  <TableCell className="whitespace-normal">
                    {r.registeredOn ? (
                      <>
                        {formatDate(r.registeredOn)}
                        {r.duty > 0n ? (
                          <div className="text-xs text-muted-foreground">
                            {t("taxes.dutyPaid", { amount: money(r.duty) })}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("registration.none")}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>{t("taxes.total")}</TableCell>
                <TableCell className="text-end">{amount(taxes.all.due)}</TableCell>
                <TableCell className="text-end">{amount(taxes.all.ht)}</TableCell>
                <TableCell className="text-end">{amount(taxes.all.vat)}</TableCell>
                <TableCell className="text-end">{amount(taxes.all.collected)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("taxes.note")}</p>
    </div>
  );
}
