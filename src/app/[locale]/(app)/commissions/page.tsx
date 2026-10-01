import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Pagination } from "@/components/data-table/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import {
  getCommissionRates,
  listCommissionEarners,
  listCommissions,
} from "@/server/commissions/queries";
import { commissionListParams } from "@/server/commissions/schemas";

import {
  CommissionFilters,
  CommissionRatesEditor,
  PayCommissionDialog,
} from "./_components/commission-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("commissions");
  return { title: t("title") };
}

export default async function CommissionsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/commissions">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requirePermission("commission:read");
  const raw = await searchParams;
  const filters = commissionListParams.parse({
    status: typeof raw.status === "string" ? raw.status : undefined,
    userId: typeof raw.userId === "string" ? raw.userId : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const result = await listCommissions(ctx, filters);
  const earners = can(ctx.roles, "commission:read_all") ? await listCommissionEarners(ctx) : null;
  const rates = can(ctx.roles, "organization:update") ? await getCommissionRates(ctx) : null;
  const canPay = can(ctx.roles, "commission:update");
  const t = await getTranslations();
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={t("commissions.title")} description={t("commissions.description")} />
      <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="commission-totals">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
          <dt>{t("commissions.toPay")}</dt>
          <dd className="text-lg font-semibold tabular-nums" dir="ltr">
            {money(result.earned)}
          </dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="text-muted-foreground">{t("commissions.paidTotal")}</dt>
          <dd className="text-lg font-semibold tabular-nums" dir="ltr">
            {money(result.paid)}
          </dd>
        </div>
      </dl>
      <CommissionFilters earners={earners} />
      {result.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("commissions.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="commissions">
            <TableHeader>
              <TableRow>
                <TableHead>{t("commissions.columns.sale")}</TableHead>
                <TableHead>{t("commissions.columns.commercial")}</TableHead>
                <TableHead className="text-end">{t("commissions.columns.base")}</TableHead>
                <TableHead className="text-end">{t("commissions.columns.rate")}</TableHead>
                <TableHead className="text-end">{t("commissions.columns.amount")}</TableHead>
                <TableHead>{t("commissions.columns.earnedOn")}</TableHead>
                <TableHead>{t("commissions.columns.status")}</TableHead>
                {canPay ? (
                  <TableHead>
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-normal">
                    <Link
                      href={`/sales/${row.reservationId}`}
                      className="font-medium tabular-nums hover:underline"
                      dir="ltr"
                    >
                      {row.saleNumber ?? row.reservationNumber}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      <bdi dir="ltr">{row.unitCode}</bdi> · {row.projectName}
                    </span>
                  </TableCell>
                  <TableCell>{row.commercialName}</TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(row.base)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatShare(row.rateBp)}
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums" dir="ltr">
                    {money(row.amount)}
                  </TableCell>
                  <TableCell className="tabular-nums" dir="ltr">
                    {formatDate(row.earnedOn)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`sales.commission.status.${row.status}`)}</Badge>
                    {row.paidOn ? (
                      <span className="block text-xs text-muted-foreground">
                        {t("commissions.paidOnDate", { date: formatDate(row.paidOn) })}
                      </span>
                    ) : null}
                  </TableCell>
                  {canPay ? (
                    <TableCell>
                      {row.status === "earned" ? (
                        <PayCommissionDialog
                          commissionId={row.id}
                          label={`${row.commercialName} · ${money(row.amount)}`}
                          today={today}
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        pathname="/commissions"
        params={{ status: filters.status, userId: filters.userId }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
      {rates ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("commissions.rates.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CommissionRatesEditor rates={rates} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
