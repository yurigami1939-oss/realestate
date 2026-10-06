import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { OpenCompanyButton } from "@/components/group/open-company";
import { Badge } from "@/components/ui/badge";
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
import { requireTenantCtx } from "@/server/auth/page-guard";
import { getGroupOverview } from "@/server/group/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("group");
  return { title: t("title") };
}

/**
 * Vue groupe: the companies the gérant runs side by side — this year's sales and collections,
 * receivables overdue and expected, stock for sale, cash on the accounts — with their total.
 */
export default async function GroupPage({ params }: PageProps<"/[locale]/group">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requireTenantCtx();
  const overview = await getGroupOverview(ctx);
  if (!overview) notFound();
  const t = await getTranslations("group");
  const money = (v: bigint) => formatDZD(v, locale);
  const columns = [
    "reserved",
    "sales",
    "collected",
    "overdue",
    "expected",
    "stock",
    "cash",
  ] as const;
  const cells = (c: (typeof overview)["total"]) => ({
    reserved: (
      <>
        <span className="block">{t("count", { count: c.reservations })}</span>
        <span className="text-xs text-muted-foreground">{money(c.reserved)}</span>
      </>
    ),
    sales: t("count", { count: c.sales }),
    collected: money(c.collected),
    overdue: (
      <span className={c.overdue > 0n ? "text-red-800" : undefined}>{money(c.overdue)}</span>
    ),
    expected: money(c.expected),
    stock: (
      <>
        <span className="block">{t("units", { count: c.available })}</span>
        <span className="text-xs text-muted-foreground">{money(c.stockValue)}</span>
      </>
    ),
    cash: money(c.cash),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={t("title")} description={t("description", { year: overview.year })} />
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="group-companies">
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.company")}</TableHead>
              {columns.map((key) => (
                <TableHead key={key} className="text-end">
                  {t(`columns.${key}`)}
                </TableHead>
              ))}
              <TableHead>
                <span className="sr-only">{t("columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.companies.map((company) => {
              const row = cells(company);
              return (
                <TableRow key={company.id} data-company={company.name}>
                  <TableCell className="font-medium whitespace-normal">
                    {company.name}
                    {company.active ? (
                      <Badge variant="secondary" className="ms-2">
                        {t("active")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  {columns.map((key) => (
                    <TableCell key={key} className="text-end tabular-nums" dir="ltr">
                      {row[key]}
                    </TableCell>
                  ))}
                  <TableCell>
                    {company.active ? null : <OpenCompanyButton organizationId={company.id} />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">{t("total")}</TableCell>
              {columns.map((key) => (
                <TableCell key={key} className="text-end font-semibold tabular-nums" dir="ltr">
                  {cells(overview.total)[key]}
                </TableCell>
              ))}
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
    </div>
  );
}
