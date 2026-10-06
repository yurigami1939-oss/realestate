import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Pagination } from "@/components/data-table/pagination";
import { DecideDiscountDialog, DiscountStateBadge } from "@/components/discounts/discount-dialogs";
import { DiscountFilters } from "@/components/discounts/discount-filters";
import { ConfirmAction } from "@/components/forms/confirm-action";
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
import { DISCOUNT_APPROVAL_DAYS } from "@/lib/discounts";
import { formatDZD } from "@/lib/money";
import { requirePermission } from "@/server/auth/page-guard";
import { cancelDiscountRequestAction } from "@/server/discounts/actions";
import { listDiscountRequests } from "@/server/discounts/queries";
import { discountListParams } from "@/server/discounts/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("discounts");
  return { title: t("title") };
}

/** Managers decide the discounts their commercials ask for (CLAUDE.md §7). */
export default async function DiscountRequestsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/sales/discounts">) {
  const { locale: raw } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("discount:decide");
  const filters = discountListParams.parse(await searchParams);
  const result = await listDiscountRequests(ctx, filters);
  const t = await getTranslations("discounts");
  const money = (v: bigint) => formatDZD(v, locale);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description", { days: DISCOUNT_APPROVAL_DAYS })}
        crumbs={[{ label: t("salesCrumb"), href: "/sales" }]}
      />
      <DiscountFilters state={filters.state} />
      {result.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="discount-requests">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.lead")}</TableHead>
                <TableHead>{t("columns.unit")}</TableHead>
                <TableHead className="text-end">{t("columns.listPrice")}</TableHead>
                <TableHead className="text-end">{t("columns.amount")}</TableHead>
                <TableHead>{t("columns.reason")}</TableHead>
                <TableHead>{t("columns.state")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => (
                <TableRow key={r.id} data-request={r.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(r.requestedAt)}
                    <span className="block text-xs text-muted-foreground">{r.requesterName}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Link href={`/leads/${r.leadId}`} className="font-medium hover:underline">
                      {r.leadName}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Link
                      href={`/projects/${r.projectId}/units/${r.unitId}`}
                      className="hover:underline"
                    >
                      <bdi dir="ltr">{r.unitCode}</bdi>
                    </Link>
                    <span className="block text-xs text-muted-foreground">{r.projectName}</span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(r.listPrice)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    <span dir="ltr">{money(r.amount)}</span>
                    {r.approvedAmount !== null && r.validUntil ? (
                      <span className="block text-xs text-emerald-700">
                        {t("approvedUpTo", {
                          amount: money(r.approvedAmount),
                          date: formatDate(r.validUntil),
                        })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    {r.reason}
                    {r.decisionNote ? (
                      <span className="block text-xs text-muted-foreground">
                        {t("decisionNote", { note: r.decisionNote })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <DiscountStateBadge state={r.state} />
                    {r.deciderName && r.decidedAt ? (
                      <span className="block text-xs text-muted-foreground">
                        {t("decidedBy", {
                          name: r.deciderName,
                          date: formatDateTime(r.decidedAt),
                        })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {r.state === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <DecideDiscountDialog request={r} />
                        <ConfirmAction
                          action={cancelDiscountRequestAction}
                          input={{ requestId: r.id }}
                          label={t("cancel")}
                          title={t("cancelTitle")}
                          description={t("cancelDescription")}
                          confirmLabel={t("cancel")}
                          successMessage={t("cancelled")}
                          variant="ghost"
                          size="sm"
                        />
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        pathname="/sales/discounts"
        params={{ state: filters.state }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
