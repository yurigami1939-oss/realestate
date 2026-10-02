"use client";

import { useTranslations } from "next-intl";

import { LeadStageBadge } from "@/components/crm/badges";
import { PhoneText } from "@/components/crm/phone";
import { DataTable, dataTableColumns } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { LeadListRow } from "@/server/crm/queries";

const column = dataTableColumns<LeadListRow>();

export function LeadsTable({
  rows,
  showAssignee,
  empty,
}: {
  rows: LeadListRow[];
  showAssignee: boolean;
  empty: string;
}) {
  const t = useTranslations("crm");

  const columns = column.columns([
    column.accessor("fullName", {
      header: () => t("leads.columns.name"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/leads/${row.original.id}`} className="font-medium hover:underline">
            {row.original.fullName}
          </Link>
          {row.original.duplicate ? (
            <Badge variant="outline" className="border-amber-400 text-amber-800">
              {t("leads.duplicate")}
            </Badge>
          ) : null}
        </div>
      ),
    }),
    column.accessor("phone", {
      header: () => t("leads.columns.phone"),
      cell: ({ getValue }) => <PhoneText value={getValue()} />,
    }),
    column.accessor("stage", {
      header: () => t("leads.columns.stage"),
      cell: ({ getValue }) => <LeadStageBadge stage={getValue()} />,
    }),
    column.accessor("source", {
      header: () => t("leads.columns.source"),
      cell: ({ getValue }) => t(`source.${getValue()}`),
    }),
    column.accessor("projectName", {
      header: () => t("leads.columns.project"),
      cell: ({ getValue }) => getValue() ?? "—",
    }),
    ...(showAssignee
      ? [
          column.accessor("assigneeName", {
            header: () => t("leads.columns.assignee"),
            cell: ({ getValue }) => getValue() ?? t("leads.unassigned"),
          }),
        ]
      : []),
    column.accessor("nextFollowUpAt", {
      header: () => t("leads.columns.nextFollowUp"),
      cell: ({ row }) => {
        const due = row.original.nextFollowUpAt;
        if (!due) return "—";
        return (
          <span
            className={cn(
              "whitespace-nowrap",
              row.original.followUpOverdue && "font-medium text-rose-700",
            )}
          >
            {formatDateTime(due)}
          </span>
        );
      },
    }),
    column.accessor("lastActivityAt", {
      header: () => t("leads.columns.lastActivity"),
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(getValue())}
        </span>
      ),
    }),
  ]);

  return <DataTable columns={columns} data={rows} empty={empty} testId="leads-table" />;
}
