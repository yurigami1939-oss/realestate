import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ChargeDocumentPdf } from "@/components/residences/charge-document-pdf";
import { PendingDocumentsRefresher } from "@/components/sales/document-pdf";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toLocale } from "@/i18n/locales";
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getChargePeriod } from "@/server/charges/queries";

import { CancelPeriodDialog } from "../_components/cancel-period-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("charges.calls");
  return { title: t("title") };
}

export default async function ChargePeriodPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/calls/[periodId]">) {
  const { locale, residenceId, periodId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("charge:read");
  const period = await getChargePeriod(ctx, periodId);
  if (!period || period.residenceId !== residenceId) notFound();
  const t = await getTranslations("charges.calls");
  const tp = await getTranslations("charges.period");
  const tr = await getTranslations("residences");
  const moneyLocale = (await getLocale()) === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, moneyLocale);
  const label = tp(period.frequency, { year: period.year, index: period.periodIndex });
  const live = period.status === "issued";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={label}
        description={t("title")}
        crumbs={[
          { label: tr("title"), href: "/residences" },
          { label: period.residenceName, href: `/residences/${residenceId}` },
          { label: t("title"), href: `/residences/${residenceId}/calls` },
        ]}
        badge={
          <Badge variant={live ? "secondary" : "outline"}>{t(`status.${period.status}`)}</Badge>
        }
        actions={
          live && can(ctx.roles, "charge:cancel") ? (
            <CancelPeriodDialog periodId={period.id} period={label} />
          ) : null
        }
      />
      {!live && period.cancelledAt ? (
        <Alert>
          <AlertDescription>
            {t("cancelledNotice", {
              date: formatDate(period.cancelledAt),
              name: period.cancelledByName ?? "—",
              reason: period.cancellationReason ?? "",
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("summary.issuedOn")}</dt>
          <dd className="font-medium">{formatDate(period.issuedOn)}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("summary.dueOn")}</dt>
          <dd className="font-medium">{formatDate(period.dueOn)}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("summary.total")}</dt>
          <dd className="font-medium tabular-nums">
            <bdi dir="ltr">{money(period.total)}</bdi>
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("summary.reserve")}</dt>
          <dd className="font-medium tabular-nums">
            <bdi dir="ltr">{money(period.reserve)}</bdi>
          </dd>
        </div>
      </dl>
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="charge-calls">
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.number")}</TableHead>
              <TableHead>{t("columns.unit")}</TableHead>
              <TableHead>{t("columns.addressee")}</TableHead>
              <TableHead className="text-end">{t("columns.total")}</TableHead>
              <TableHead className="text-end">{t("columns.reserve")}</TableHead>
              <TableHead>{t("columns.document")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {period.calls.map((c) => (
              <TableRow key={c.id} data-unit={c.unitCode}>
                <TableCell dir="ltr" className="text-start font-medium">
                  {c.number}
                </TableCell>
                <TableCell dir="ltr" className="text-start">
                  {c.unitCode}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {c.addresseeName ?? (
                    <span className="text-muted-foreground">{t("promoter")}</span>
                  )}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(c.amount)}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(c.reserve)}
                </TableCell>
                <TableCell>
                  <ChargeDocumentPdf
                    fileId={c.pdfFileId}
                    kind="charge_call"
                    id={c.id}
                    label={t("pdf", { number: c.number })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PendingDocumentsRefresher pending={period.calls.some((c) => c.pdfFileId === null)} />
    </div>
  );
}
