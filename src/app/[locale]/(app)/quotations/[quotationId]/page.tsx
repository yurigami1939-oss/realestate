import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toLocale } from "@/i18n/locales";
import { formatDate, formatDateTime, todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { quotationState } from "@/lib/quotations";
import { requirePermission } from "@/server/auth/page-guard";
import { getQuotation, type QuotationDetail } from "@/server/quotations/queries";

import { CancelQuotationDialog, QuotationPdf } from "./_components/quotation-actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/quotations/[quotationId]">): Promise<Metadata> {
  const ctx = await requirePermission("lead:read");
  const quotation = await getQuotation(ctx, (await params).quotationId);
  return { title: quotation?.number };
}

export default async function QuotationPage({
  params,
}: PageProps<"/[locale]/quotations/[quotationId]">) {
  const { locale, quotationId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("lead:read");
  const q = await getQuotation(ctx, quotationId);
  if (!q) notFound();
  const t = await getTranslations();
  const state = quotationState(q, todayInAlgiers());

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={`${t("quotations.title")} ${q.number}`}
        badge={
          <Badge variant={state === "issued" ? "default" : "secondary"}>
            {t(`quotations.status.${state}`)}
          </Badge>
        }
        crumbs={[
          { label: t("crm.leads.title"), href: "/leads" },
          { label: q.leadName, href: `/leads/${q.leadId}` },
        ]}
        actions={
          q.status === "issued" && can(ctx.roles, "quotation:cancel") ? (
            <CancelQuotationDialog quotationId={q.id} number={q.number} />
          ) : null
        }
      />
      {q.status === "cancelled" ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {t("quotations.cancelledBy", {
            date: q.cancelledAt ? formatDateTime(q.cancelledAt) : "",
            name: q.cancellerName ?? "—",
            reason: q.cancellationReason ?? "",
          })}
        </p>
      ) : (
        <QuotationPdf quotationId={q.id} pdfFileId={q.pdfFileId} />
      )}
      <Summary q={q} />
      <Schedule q={q} />
    </div>
  );
}

function Summary({ q }: { q: QuotationDetail }) {
  const t = useTranslations("quotations");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: t("lead"),
      value: (
        <>
          <Link href={`/leads/${q.leadId}`} className="hover:underline">
            {q.leadName}
          </Link>{" "}
          · <PhoneText value={q.leadPhone} />
        </>
      ),
    },
    { label: t("project"), value: q.projectName },
    {
      label: t("unit"),
      value: (
        <>
          <bdi dir="ltr">{q.unitCode}</bdi> · {q.buildingName}
          {q.unitTypology ? ` · ${q.unitTypology}` : ""}
        </>
      ),
    },
    { label: t("listPrice"), value: <bdi dir="ltr">{formatDZD(q.listPrice, locale)}</bdi> },
    ...(q.discount > 0n
      ? [
          {
            label: t("discount"),
            value: <bdi dir="ltr">− {formatDZD(q.discount, locale)}</bdi>,
          },
        ]
      : []),
    { label: t("net"), value: <b dir="ltr">{formatDZD(q.price, locale)}</b> },
  ];
  return (
    <Card>
      <CardContent className="space-y-3">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-3 border-b pb-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-end">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          {t("issuedBy", { date: formatDateTime(q.issuedAt), name: q.issuerName })} ·{" "}
          {t("validUntil", { date: formatDate(q.validUntil) })}
        </p>
        {q.notes ? <p className="text-sm">{q.notes}</p> : null}
      </CardContent>
    </Card>
  );
}

function Schedule({ q }: { q: QuotationDetail }) {
  const t = useTranslations("quotations");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const due = (line: QuotationDetail["lines"][number]) => {
    if (line.trigger === "signing") return t("atSigning");
    if (line.trigger === "months_after_signing") return line.dueOn ? formatDate(line.dueOn) : "—";
    return line.dueOn
      ? t("plannedMilestone", { name: line.milestoneName ?? "—", date: formatDate(line.dueOn) })
      : t("unplannedMilestone", { name: line.milestoneName ?? "—" });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("plan")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table data-testid="quotation-lines">
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.step")}</TableHead>
              <TableHead>{t("columns.due")}</TableHead>
              <TableHead className="text-end">{t("columns.share")}</TableHead>
              <TableHead className="text-end">{t("columns.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.lines.map((line) => (
              <TableRow key={line.position}>
                <TableCell className="whitespace-normal">{line.label}</TableCell>
                <TableCell className="whitespace-normal">{due(line)}</TableCell>
                <TableCell className="text-end" dir="ltr">
                  {formatShare(line.shareBp)}
                </TableCell>
                <TableCell className="text-end whitespace-nowrap" dir="ltr">
                  {formatDZD(line.amount, locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>{t("net")}</TableCell>
              <TableCell className="text-end whitespace-nowrap" dir="ltr">
                {formatDZD(q.price, locale)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
