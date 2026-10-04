import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { ChargeReminderDialog } from "@/components/residences/charge-reminder-dialog";
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
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD, sumCentimes } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listOverdueCharges } from "@/server/charges/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("charges.overdue");
  return { title: t("title") };
}

export default async function OverdueChargesPage({
  params,
}: PageProps<"/[locale]/residences/overdue">) {
  const { locale } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("charge:read");
  const rows = await listOverdueCharges(ctx);
  const t = await getTranslations("charges.overdue");
  const moneyLocale = (await getLocale()) === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, moneyLocale);
  const canRemind = can(ctx.roles, "charge:remind");
  const today = todayInAlgiers();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-md border p-2">
              <dt className="text-muted-foreground">{t("total")}</dt>
              <dd className="font-medium text-red-700 tabular-nums">
                <bdi dir="ltr">{money(sumCentimes(rows.map((r) => r.overdue)))}</bdi>
              </dd>
              <dd className="text-xs text-muted-foreground">
                {t("count", { count: rows.length })}
              </dd>
            </div>
          </dl>
          <div className="overflow-x-auto rounded-lg border">
            <Table data-testid="overdue-charges">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.residence")}</TableHead>
                  <TableHead>{t("columns.unit")}</TableHead>
                  <TableHead>{t("columns.coOwner")}</TableHead>
                  <TableHead className="text-end">{t("columns.overdue")}</TableHead>
                  <TableHead>{t("columns.since")}</TableHead>
                  <TableHead>{t("columns.reminded")}</TableHead>
                  {canRemind ? (
                    <TableHead>
                      <span className="sr-only">{t("columns.actions")}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.unitId} data-unit={r.code}>
                    <TableCell className="whitespace-normal">{r.residenceName}</TableCell>
                    <TableCell>
                      <Link
                        href={`/residences/${r.residenceId}/accounts/${r.unitId}`}
                        className="font-medium hover:underline"
                        dir="ltr"
                      >
                        {r.code}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {r.coOwner ?? <span className="text-muted-foreground">{t("promoter")}</span>}
                      {r.phone ? (
                        <div className="text-xs text-muted-foreground">
                          <PhoneText value={r.phone} />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-end font-medium text-red-700 tabular-nums" dir="ltr">
                      {money(r.overdue)}
                    </TableCell>
                    <TableCell>
                      {formatDate(r.oldestDueOn)}
                      <div className="text-xs text-muted-foreground">
                        {t("days", { days: r.daysLate })}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.lastReminderAt ? formatDate(r.lastReminderAt) : t("never")}
                    </TableCell>
                    {canRemind ? (
                      <TableCell className="text-end">
                        <ChargeReminderDialog
                          residenceId={r.residenceId}
                          unitId={r.unitId}
                          code={r.code}
                          overdue={r.overdue}
                          today={today}
                          compact
                        />
                      </TableCell>
                    ) : null}
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
