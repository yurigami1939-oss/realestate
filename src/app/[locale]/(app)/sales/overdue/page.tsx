import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { Pagination } from "@/components/data-table/pagination";
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
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { requirePermission } from "@/server/auth/page-guard";
import { listOverdueSales } from "@/server/collections/queries";
import { overdueListParams } from "@/server/collections/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("collections");
  return { title: t("title") };
}

export default async function OverduePage({
  params,
  searchParams,
}: PageProps<"/[locale]/sales/overdue">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requirePermission("sale:read");
  const raw = await searchParams;
  const filters = overdueListParams.parse({
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const result = await listOverdueSales(ctx, filters);
  const t = await getTranslations("collections");
  const money = (v: bigint) => formatDZD(v, locale);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {result.total === 0 ? null : (
        <dl className="grid gap-2 text-sm sm:grid-cols-3" data-testid="overdue-totals">
          <div className="rounded-md border p-3">
            <dt className="text-muted-foreground">{t("count", { count: result.total })}</dt>
          </div>
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
            <dt>{t("totalOverdue")}</dt>
            <dd className="text-lg font-semibold tabular-nums" dir="ltr">
              {money(result.overdue)}
            </dd>
          </div>
          {result.penalties > 0n ? (
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">{t("totalPenalties")}</dt>
              <dd className="text-lg font-semibold tabular-nums" dir="ltr">
                {money(result.penalties)}
              </dd>
            </div>
          ) : null}
        </dl>
      )}
      {result.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="overdue-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.sale")}</TableHead>
                <TableHead>{t("columns.buyers")}</TableHead>
                <TableHead>{t("columns.unit")}</TableHead>
                <TableHead className="text-end">{t("columns.overdue")}</TableHead>
                <TableHead>{t("columns.since")}</TableHead>
                <TableHead>{t("columns.reminded")}</TableHead>
                <TableHead>{t("columns.commercial")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id} data-sale={row.number}>
                  <TableCell>
                    <Link
                      href={`/sales/${row.id}`}
                      className="font-medium tabular-nums hover:underline"
                      dir="ltr"
                    >
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {row.buyers}
                    {row.phone ? (
                      <span className="block text-xs text-muted-foreground">
                        <PhoneText value={row.phone} />
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <bdi dir="ltr">{row.unitCode}</bdi>
                    <span className="text-muted-foreground"> · {row.projectName}</span>
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums" dir="ltr">
                    {money(row.overdue)}
                  </TableCell>
                  <TableCell>
                    <span className="tabular-nums" dir="ltr">
                      {formatDate(row.oldestDueOn)}
                    </span>
                    <span className="block text-xs text-red-800">
                      {t("days", { days: row.daysLate })}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums" dir="ltr">
                    {row.lastReminderAt ? formatDate(row.lastReminderAt) : "—"}
                  </TableCell>
                  <TableCell>{row.commercialName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        pathname="/sales/overdue"
        params={{}}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
