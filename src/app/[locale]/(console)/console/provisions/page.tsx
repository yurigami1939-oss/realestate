import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ProvisionActions, ProvisionDialog } from "@/components/console/provision-forms";
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
import { formatDate, toCalendarDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DEFAULT_PLAN_CODE } from "@/server/console/accounts";
import { requireOperator } from "@/server/console/guard";
import { listProvisions } from "@/server/console/provisions";
import { listCatalog } from "@/server/console/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("console.provisions");
  return { title: t("title") };
}

const stateClasses = {
  live: "border-info/25 bg-info-soft text-info",
  used: "border-success/25 bg-success-soft text-success",
  revoked: "border-border bg-muted text-muted-foreground",
  expired: "border-warning/25 bg-warning-soft text-warning",
} as const;

/** The promoters invited (CLAUDE.console.md §8): new clients and other SARLs of a client. */
export default async function ConsoleProvisionsPage({
  params,
}: PageProps<"/[locale]/console/provisions">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const operator = await requireOperator();
  const rows = await listProvisions(operator);
  const { plans } = await listCatalog(operator);
  const t = await getTranslations("console.provisions");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <ProvisionDialog
            defaultPlan={DEFAULT_PLAN_CODE}
            plans={plans
              .filter((p) => !p.archivedAt)
              .map((p) => ({ code: p.code, name: locale === "ar" ? p.nameAr : p.nameFr }))}
          />
        }
      />
      {rows.length === 0 ? (
        <p className="empty-state">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card shadow-card">
          <Table stack data-testid="provisions">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.client")}</TableHead>
                <TableHead>{t("columns.account")}</TableHead>
                <TableHead>{t("columns.plan")}</TableHead>
                <TableHead>{t("columns.state")}</TableHead>
                <TableHead>{t("columns.expires")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{row.legalName}</div>
                    <div className="text-footnote text-muted-foreground" dir="ltr">
                      {row.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.billingAccountId ? (
                      <Link
                        href={`/console/accounts/${row.billingAccountId}`}
                        className="hover:underline"
                      >
                        {row.accountName}
                      </Link>
                    ) : (
                      t("newClient")
                    )}
                  </TableCell>
                  <TableCell>{locale === "ar" ? row.planNameAr : row.planNameFr}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium",
                        stateClasses[row.state],
                      )}
                    >
                      {t(`states.${row.state}`)}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatDate(toCalendarDate(row.expiresAt))}
                  </TableCell>
                  <TableCell>
                    {row.state === "live" || row.state === "expired" ? (
                      <ProvisionActions provisionId={row.id} email={row.email} />
                    ) : null}
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
