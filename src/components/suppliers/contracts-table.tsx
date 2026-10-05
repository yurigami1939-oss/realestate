import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { ConfirmAction } from "@/components/forms/confirm-action";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { deleteContractAction } from "@/server/suppliers/actions";
import type { ContractRow, ContractTarget } from "@/server/suppliers/queries";

import { ContractDialog } from "./contract-dialog";
import { SupplierScan } from "./supplier-scan";

/** Contracts with their period, category and state; shows the supplier or the residence. */
export function ContractsTable({
  contracts,
  show,
  editable,
  targets,
  today,
}: {
  contracts: ContractRow[];
  show: "supplier" | "residence";
  editable: boolean;
  targets: ContractTarget[];
  today: string;
}) {
  const t = useTranslations("suppliers.contracts");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  if (contracts.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table data-testid="contracts">
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.label")}</TableHead>
            <TableHead>{t(`columns.${show}`)}</TableHead>
            <TableHead>{t("columns.category")}</TableHead>
            <TableHead>{t("columns.period")}</TableHead>
            <TableHead className="text-end">{t("columns.annualAmount")}</TableHead>
            <TableHead>{t("columns.state")}</TableHead>
            {editable ? (
              <TableHead>
                <span className="sr-only">{t("columns.actions")}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="whitespace-normal">
                <span className="font-medium">{c.label}</span>
                <SupplierScan
                  purpose="supplier_contract.scan"
                  entityId={c.id}
                  fileId={c.scanFileId}
                  editable={editable}
                />
              </TableCell>
              <TableCell className="whitespace-normal">
                {show === "supplier" ? (
                  <Link href={`/suppliers/${c.supplierId}`} className="hover:underline">
                    {c.supplierName}
                  </Link>
                ) : (
                  <Link href={`/residences/${c.residenceId}/expenses`} className="hover:underline">
                    {c.residenceName}
                  </Link>
                )}
              </TableCell>
              <TableCell className="whitespace-normal">{c.categoryName ?? "—"}</TableCell>
              <TableCell>
                {c.endOn
                  ? t("period", { from: formatDate(c.startOn), to: formatDate(c.endOn) })
                  : t("periodOpen", { from: formatDate(c.startOn) })}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {c.annualAmount != null ? formatDZD(c.annualAmount, locale) : "—"}
              </TableCell>
              <TableCell>
                <Badge variant={c.running ? "secondary" : "outline"}>
                  {t(c.running ? "running" : "notRunning")}
                </Badge>
              </TableCell>
              {editable ? (
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <ContractDialog contract={c} targets={targets} today={today} />
                    <ConfirmAction
                      action={deleteContractAction}
                      input={{ contractId: c.id }}
                      label={t("delete")}
                      icon={<Trash2 data-icon="inline-start" />}
                      variant="ghost"
                      destructive
                      title={t("deleteTitle", { label: c.label })}
                      description={t("deleteDescription")}
                      confirmLabel={t("delete")}
                      successMessage={t("deleted")}
                    />
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
