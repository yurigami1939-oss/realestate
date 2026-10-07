import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Pagination } from "@/components/data-table/pagination";
import { OnlinePaymentStatusBadge, TestModeBadge } from "@/components/online-payments/badges";
import {
  OnlinePaymentFilters,
  RecheckOnlinePayment,
  RefundOnlinePayment,
} from "@/components/online-payments/staff-ui";
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
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listOnlinePayments, ONLINE_PAYMENTS_PAGE_SIZE } from "@/server/online-payments/queries";
import { onlinePaymentListParams } from "@/server/online-payments/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onlinePayments");
  return { title: t("title") };
}

/**
 * Online payments of the organization (CLAUDE.md §7 Online payment): what SATIM confirmed, the
 * receipt each was recorded with, the ones paid but not recorded (refund or settle by hand).
 */
export default async function OnlinePaymentsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/online-payments">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requirePermission("payment:read");
  const query = await searchParams;
  const value = (key: string) => (typeof query[key] === "string" ? query[key] : undefined);
  const filters = onlinePaymentListParams.parse({
    status: value("status"),
    issues: value("issues"),
    page: value("page"),
    q: value("q") ?? "",
  });
  const { rows, total, issues, page } = await listOnlinePayments(ctx, filters);
  const t = await getTranslations("onlinePayments");
  const ti = await getTranslations();
  const money = (v: bigint) => formatDZD(v, locale);
  const mayRecheck = can(ctx.roles, "payment:create");
  const mayRefund = can(ctx.roles, "payment:cancel");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {issues > 0 ? (
        <p
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          data-testid="online-payment-issues"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("issuesBanner", { count: issues })}
        </p>
      ) : null}
      <OnlinePaymentFilters />
      <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="online-payments">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.object")}</TableHead>
                <TableHead>{t("columns.payer")}</TableHead>
                <TableHead className="text-end">{t("columns.amount")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.gateway")}</TableHead>
                <TableHead>{t("columns.receipt")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const receiptNumber =
                  p.receiptNumber ?? p.chargeReceiptNumber ?? p.rentReceiptNumber;
                const href = {
                  sale: `/sales/${p.reservationId ?? ""}`,
                  charges: `/residences/${p.residenceId ?? ""}/accounts/${p.unitId ?? ""}`,
                  rent: `/rentals/${p.leaseId ?? ""}`,
                }[p.purpose];
                return (
                  <TableRow key={p.id} data-order={p.orderNumber}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(p.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Link href={href} className="font-medium hover:underline">
                        {p.purpose === "charges" ? p.residenceName : p.projectName} ·{" "}
                        <bdi dir="ltr">{p.unitCode}</bdi>
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {t(`purpose.${p.purpose}`)}
                        {p.saleNumber || p.leaseNumber ? (
                          <>
                            {" · "}
                            <bdi dir="ltr">{p.saleNumber ?? p.leaseNumber}</bdi>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">{p.payerName}</TableCell>
                    <TableCell className="text-end">
                      <bdi dir="ltr" className="tabular-nums">
                        {money(p.amount)}
                      </bdi>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-center gap-1">
                        <OnlinePaymentStatusBadge status={p.status} />
                        {p.environment === "test" ? <TestModeBadge /> : null}
                      </div>
                      {p.status === "paid" && p.issue ? (
                        <div className="mt-1 text-xs text-amber-800">
                          {t("issue", {
                            reason: ti.has(p.issue as Parameters<typeof ti>[0])
                              ? ti(p.issue as Parameters<typeof ti>[0])
                              : p.issue,
                          })}
                        </div>
                      ) : null}
                      {p.status === "refunded" && p.refundedAt ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t("refunded", {
                            date: formatDate(p.refundedAt),
                            reason: p.refundReason ?? "",
                          })}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal">
                      <div>{t("order", { number: p.orderNumber })}</div>
                      {p.approvalCode ? (
                        <div className="text-muted-foreground">
                          {t("approval", { code: p.approvalCode })}
                        </div>
                      ) : null}
                      {p.gatewayMessage ? (
                        <div className="text-muted-foreground">{p.gatewayMessage}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {receiptNumber ? <bdi dir="ltr">{receiptNumber}</bdi> : "—"}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        {mayRecheck && (p.status === "pending" || p.status === "expired") ? (
                          <RecheckOnlinePayment onlinePaymentId={p.id} />
                        ) : null}
                        {mayRefund && p.status === "paid" ? (
                          <RefundOnlinePayment onlinePaymentId={p.id} amount={money(p.amount)} />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        pathname="/online-payments"
        params={{
          status: filters.status,
          issues: filters.issues,
          q: filters.q ?? undefined,
        }}
        page={page}
        pageSize={ONLINE_PAYMENTS_PAGE_SIZE}
        total={total}
      />
    </div>
  );
}
