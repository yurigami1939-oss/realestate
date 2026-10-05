import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { ConfirmAction } from "@/components/forms/confirm-action";
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
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/dates";
import { formatDZD, sumCentimes } from "@/lib/money";
import { deleteInvoiceAction } from "@/server/suppliers/actions";
import type { ContractRow, InvoiceRow } from "@/server/suppliers/queries";

import { InvoiceDialog, PayInvoiceDialog } from "./invoice-dialogs";
import { SupplierScan } from "./supplier-scan";

/** Supplier invoices with their booking and payment state; actions while unpaid. */
export function InvoicesTable({
  invoices,
  show,
  editable,
  residenceId,
  suppliers,
  categories,
  contracts,
  today,
}: {
  invoices: InvoiceRow[];
  show: "supplier" | "residence";
  editable: boolean;
  residenceId?: string;
  suppliers?: { id: string; name: string }[];
  categories?: { id: string; name: string }[];
  contracts?: ContractRow[];
  today: string;
}) {
  const t = useTranslations("suppliers.invoices");
  const tp = useTranslations("payments");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, locale);
  if (invoices.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table data-testid="invoices">
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.date")}</TableHead>
            <TableHead>{t(`columns.${show}`)}</TableHead>
            <TableHead>{t("columns.number")}</TableHead>
            <TableHead>{t("columns.label")}</TableHead>
            <TableHead>{t("columns.booking")}</TableHead>
            <TableHead className="text-end">{t("columns.amount")}</TableHead>
            <TableHead>{t("columns.state")}</TableHead>
            {editable ? (
              <TableHead>
                <span className="sr-only">{t("columns.actions")}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((i) => (
            <TableRow key={i.id}>
              <TableCell>{formatDate(i.invoiceOn)}</TableCell>
              <TableCell className="whitespace-normal">
                {show === "supplier" ? (
                  <Link href={`/suppliers/${i.supplierId}`} className="hover:underline">
                    {i.supplierName}
                  </Link>
                ) : (
                  <Link href={`/residences/${i.residenceId}/expenses`} className="hover:underline">
                    {i.residenceName}
                  </Link>
                )}
              </TableCell>
              <TableCell dir="ltr" className="text-start">
                {i.number}
              </TableCell>
              <TableCell className="whitespace-normal">
                {i.label}
                <SupplierScan
                  purpose="supplier_invoice.scan"
                  entityId={i.id}
                  fileId={i.scanFileId}
                  editable={editable}
                />
              </TableCell>
              <TableCell className="whitespace-normal">
                {i.fromReserve ? (
                  <Badge variant="outline">{t("reserveFund")}</Badge>
                ) : (
                  (i.categoryName ?? "—")
                )}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(i.amount)}
              </TableCell>
              <TableCell className="whitespace-normal">
                {i.paidOn ? (
                  <span className="text-sm">
                    {t("paidOn", { date: formatDate(i.paidOn) })}
                    {i.paymentMethod ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {tp(`method.${i.paymentMethod}`)}
                      </span>
                    ) : null}
                  </span>
                ) : i.overdue ? (
                  <Badge variant="destructive">{t("overdue")}</Badge>
                ) : (
                  <Badge variant="secondary">
                    {i.dueOn ? t("dueOn", { date: formatDate(i.dueOn) }) : t("unpaid")}
                  </Badge>
                )}
              </TableCell>
              {editable ? (
                <TableCell className="text-end">
                  {i.paidOn === null ? (
                    <div className="flex justify-end gap-1">
                      <PayInvoiceDialog invoiceId={i.id} number={i.number} today={today} />
                      {residenceId && suppliers && categories && contracts ? (
                        <InvoiceDialog
                          residenceId={residenceId}
                          invoice={i}
                          suppliers={suppliers}
                          categories={categories}
                          contracts={contracts}
                          today={today}
                        />
                      ) : null}
                      <ConfirmAction
                        action={deleteInvoiceAction}
                        input={{ invoiceId: i.id }}
                        label={t("delete")}
                        icon={<Trash2 data-icon="inline-start" />}
                        variant="ghost"
                        destructive
                        title={t("deleteTitle", { number: i.number })}
                        description={t("deleteDescription")}
                        confirmLabel={t("delete")}
                        successMessage={t("deleted")}
                      />
                    </div>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={5}>{t("total")}</TableCell>
            <TableCell className="text-end tabular-nums" dir="ltr">
              {money(sumCentimes(invoices.map((i) => i.amount)))}
            </TableCell>
            <TableCell colSpan={editable ? 2 : 1} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
