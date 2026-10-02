"use client";

import { useTranslations } from "next-intl";

import { PhoneText } from "@/components/crm/phone";
import { DataTable, dataTableColumns } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { BuyerListRow } from "@/server/buyers/queries";

const column = dataTableColumns<BuyerListRow>();

export function BuyersTable({ rows, empty }: { rows: BuyerListRow[]; empty: string }) {
  const t = useTranslations("buyers");
  const columns = column.columns([
    column.accessor("lastName", {
      header: () => t("columns.name"),
      cell: ({ row }) => (
        <Link href={`/buyers/${row.original.id}`} className="font-medium hover:underline">
          {row.original.lastName} {row.original.firstName}
        </Link>
      ),
    }),
    column.accessor("phone", {
      header: () => t("columns.phone"),
      cell: ({ getValue }) => <PhoneText value={getValue()} />,
    }),
    column.accessor("nin", {
      header: () => t("columns.nin"),
      cell: ({ getValue }) => (
        <span dir="ltr" className="tabular-nums">
          {getValue() ?? "—"}
        </span>
      ),
    }),
    column.accessor("commune", {
      header: () => t("columns.place"),
      cell: ({ row }) =>
        [row.original.commune, row.original.wilaya].filter(Boolean).join(", ") || "—",
    }),
    column.accessor("ownerName", {
      header: () => t("columns.owner"),
      cell: ({ getValue }) => getValue() ?? "—",
    }),
    column.accessor("missingDocuments", {
      header: () => t("columns.documents"),
      cell: ({ getValue }) => {
        const missing = getValue();
        return (
          <Badge
            variant="outline"
            className={missing > 0 ? "border-amber-400 text-amber-800" : "text-emerald-800"}
          >
            {t("documents.missing", { count: missing })}
          </Badge>
        );
      },
    }),
  ]);
  return <DataTable columns={columns} data={rows} empty={empty} testId="buyers-table" />;
}
