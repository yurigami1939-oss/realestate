import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
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
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { requirePermission } from "@/server/auth/page-guard";
import { listOverdueRents } from "@/server/rentals/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rentals.overdue");
  return { title: t("title") };
}

/** Rents due before today and not paid, most late first (reminders only, no penalties). */
export default async function OverdueRentsPage({ params }: PageProps<"/[locale]/rentals/overdue">) {
  const { locale: raw } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("lease:read");
  const rents = await listOverdueRents(ctx);
  const t = await getTranslations("rentals");
  const money = (v: bigint) => formatDZD(v, locale);
  const total = rents.reduce((sum, r) => sum + r.overdue, 0n);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("overdue.title")}
        description={t("overdue.description")}
        crumbs={[{ label: t("title"), href: "/rentals" }]}
      />
      {rents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("overdue.empty")}</p>
      ) : (
        <>
          <p className="text-sm" data-testid="overdue-rents-total">
            {t("overdue.summary", { count: rents.length, total: money(total) })}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <Table data-testid="overdue-rents">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.lease")}</TableHead>
                  <TableHead>{t("columns.unit")}</TableHead>
                  <TableHead>{t("columns.tenant")}</TableHead>
                  <TableHead className="text-end">{t("columns.overdue")}</TableHead>
                  <TableHead>{t("overdue.since")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rents.map((r) => (
                  <TableRow key={r.id} data-unit={r.unitCode}>
                    <TableCell>
                      <Link href={`/rentals/${r.id}`} className="font-medium hover:underline">
                        <bdi dir="ltr">{r.number}</bdi>
                      </Link>
                      {r.status === "ended" ? (
                        <Badge variant="outline" className="ms-2">
                          {t("state.ended")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <bdi dir="ltr">{r.unitCode}</bdi>
                      <div className="text-xs text-muted-foreground">{r.projectName}</div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {r.tenantName}
                      <div className="text-xs text-muted-foreground">
                        <PhoneText value={r.tenantPhone} />
                      </div>
                    </TableCell>
                    <TableCell className="text-end font-medium text-red-800 tabular-nums">
                      <bdi dir="ltr">{money(r.overdue)}</bdi>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {formatDate(r.oldestDueOn)}
                      <span className="block text-xs text-muted-foreground">
                        {t("overdue.daysLate", { days: r.daysLate })}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
