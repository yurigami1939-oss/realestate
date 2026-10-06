import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Pagination } from "@/components/data-table/pagination";
import { CloseRequestDialog } from "@/components/sales/close-request-dialog";
import { RequestFilters } from "@/components/sales/request-filters";
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
import { toLocale } from "@/i18n/locales";
import { formatDate, formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/page-guard";
import { requestListParams } from "@/server/requests/schemas";
import { listPortalRequests } from "@/server/requests/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("requests");
  return { title: t("title") };
}

/** Requests buyers sent from the portal about the sales the member sees (CLAUDE.md §7). */
export default async function PortalRequestsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/sales/requests">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("sale:read");
  const filters = requestListParams.parse(await searchParams);
  const result = await listPortalRequests(ctx, filters);
  const t = await getTranslations("requests");
  const tc = await getTranslations("certificates.kind");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        crumbs={[{ label: t("salesCrumb"), href: "/sales" }]}
      />
      <RequestFilters status={filters.status} />
      {result.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="portal-requests">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.sale")}</TableHead>
                <TableHead>{t("columns.request")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.createdAt)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <Link
                      href={`/sales/${r.reservationId}`}
                      className="font-medium hover:underline"
                    >
                      {r.saleNumber}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {r.buyerName} · {r.projectName} · <bdi dir="ltr">{r.unitCode}</bdi>
                    </span>
                  </TableCell>
                  <TableCell className="max-w-96 whitespace-normal">
                    <span className="font-medium">
                      {r.kind === "certificate" && r.certificateKind
                        ? tc(r.certificateKind)
                        : t(`kind.${r.kind}`)}
                    </span>
                    {r.preferredOn ? (
                      <span className="block text-xs">
                        {t("preferredOn", { date: formatDate(r.preferredOn) })}
                      </span>
                    ) : null}
                    {r.message ? (
                      <span className="block whitespace-pre-line text-muted-foreground">
                        {r.message}
                      </span>
                    ) : null}
                    {r.answer ? (
                      <span className="block text-xs text-muted-foreground">
                        {t("answered", { answer: r.answer })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "open" ? "default" : "secondary"}>
                      {t(`status.${r.status}`)}
                    </Badge>
                    {r.handlerName && r.handledAt ? (
                      <span className="block text-xs text-muted-foreground">
                        {r.handlerName} · {formatDateTime(r.handledAt)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {r.status === "open" ? <CloseRequestDialog requestId={r.id} /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        pathname="/sales/requests"
        params={{ status: filters.status }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
