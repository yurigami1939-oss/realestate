"use client";

import { useLocale, useTranslations } from "next-intl";

import { DataTable, dataTableColumns } from "@/components/data-table/data-table";
import { SaleStatusBadge } from "@/components/sales/badges";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import type { SaleListRow } from "@/server/sales/sale-queries";

const column = dataTableColumns<SaleListRow>();

export function SalesTable({ rows, empty }: { rows: SaleListRow[]; empty: string }) {
  const t = useTranslations("sales.columns");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, locale);
  const columns = column.columns([
    column.accessor("number", {
      header: () => t("number"),
      cell: ({ row }) => (
        <Link
          href={`/sales/${row.original.id}`}
          className="font-medium tabular-nums hover:underline"
          dir="ltr"
        >
          {row.original.number}
        </Link>
      ),
    }),
    column.accessor("buyers", {
      header: () => t("buyers"),
      cell: ({ getValue }) => <span className="whitespace-normal">{getValue()}</span>,
    }),
    column.accessor("unitCode", {
      header: () => t("unit"),
      cell: ({ row }) => (
        <span>
          <span dir="ltr">{row.original.unitCode}</span>
          <span className="text-muted-foreground"> · {row.original.projectName}</span>
        </span>
      ),
    }),
    column.accessor("status", {
      header: () => t("status"),
      cell: ({ getValue }) => <SaleStatusBadge status={getValue()} />,
    }),
    column.accessor("price", {
      header: () => <span className="block text-end">{t("price")}</span>,
      cell: ({ getValue }) => (
        <span className="block text-end tabular-nums" dir="ltr">
          {money(getValue())}
        </span>
      ),
    }),
    column.accessor("paid", {
      header: () => <span className="block text-end">{t("paid")}</span>,
      cell: ({ getValue }) => (
        <span className="block text-end tabular-nums" dir="ltr">
          {money(getValue())}
        </span>
      ),
    }),
    column.accessor("reservedOn", {
      header: () => t("reservedOn"),
      cell: ({ getValue }) => (
        <span className="tabular-nums" dir="ltr">
          {formatDate(getValue())}
        </span>
      ),
    }),
    column.accessor("commercialName", {
      header: () => t("commercial"),
      cell: ({ getValue }) => getValue() ?? "—",
    }),
  ]);
  return <DataTable columns={columns} data={rows} empty={empty} testId="sales-table" />;
}
