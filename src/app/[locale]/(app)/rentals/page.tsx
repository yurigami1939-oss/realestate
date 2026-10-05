import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
import { LeaseFilters, LeaseStateBadge } from "@/components/rentals/rentals-ui";
import { Button } from "@/components/ui/button";
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
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listLeases } from "@/server/rentals/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rentals");
  return { title: t("title") };
}

/** Leases of the units the promoter keeps: active ones by default, the closest term first. */
export default async function RentalsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/rentals">) {
  const { locale: raw } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("lease:read");
  const query = await searchParams;
  const rawStatus = typeof query.status === "string" ? query.status : "active";
  const status = rawStatus === "ended" || rawStatus === "all" ? rawStatus : "active";
  const projectId = typeof query.project === "string" ? query.project : undefined;
  const { items, projects } = await listLeases(ctx, { status, projectId });
  const t = await getTranslations("rentals");
  const money = (v: bigint) => formatDZD(v, locale);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <ExportButton kind="leases" params={{ status, project: projectId }} />
            {can(ctx.roles, "lease:update") ? (
              <Button asChild>
                <Link href="/rentals/new">
                  <Plus data-icon="inline-start" />
                  {t("new")}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <LeaseFilters projects={projects} />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="leases">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.lease")}</TableHead>
                <TableHead>{t("columns.unit")}</TableHead>
                <TableHead>{t("columns.tenant")}</TableHead>
                <TableHead>{t("columns.term")}</TableHead>
                <TableHead className="text-end">{t("columns.rent")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead className="text-end">{t("columns.overdue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((l) => (
                <TableRow key={l.id} data-unit={l.unitCode}>
                  <TableCell>
                    <Link href={`/rentals/${l.id}`} className="font-medium hover:underline">
                      <bdi dir="ltr">{l.number}</bdi>
                    </Link>
                    <div className="text-xs text-muted-foreground">{t(`kind.${l.kind}`)}</div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <bdi dir="ltr">{l.unitCode}</bdi>
                    <div className="text-xs text-muted-foreground">{l.projectName}</div>
                  </TableCell>
                  <TableCell className="whitespace-normal">{l.tenantName}</TableCell>
                  <TableCell className="whitespace-normal">
                    {formatDate(l.startOn)} → {formatDate(l.endedOn ?? l.endOn)}
                  </TableCell>
                  <TableCell className="text-end">
                    <bdi dir="ltr" className="tabular-nums">
                      {money(l.monthlyRent + l.monthlyCharges)}
                    </bdi>
                    <div className="text-xs text-muted-foreground">
                      {t(`frequency.${l.frequency}`)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <LeaseStateBadge state={l.state} />
                  </TableCell>
                  <TableCell className="text-end">
                    {l.overdue > 0n ? (
                      <bdi dir="ltr" className="font-medium text-red-800 tabular-nums">
                        {money(l.overdue)}
                      </bdi>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
