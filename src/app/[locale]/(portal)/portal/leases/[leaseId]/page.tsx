import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PayOnlineDialog } from "@/components/online-payments/pay-online-dialog";
import { PortalDocument } from "@/components/portal/portal-document";
import { SignDocument } from "@/components/portal/sign-document";
import { InstallmentStateBadge } from "@/components/sales/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatAmountInput, formatDZD } from "@/lib/money";
import { onlinePaymentOffer } from "@/lib/online-payments";
import { cn } from "@/lib/utils";
import { getPortalPaymentOptions } from "@/server/online-payments/queries";
import { getPortalLease } from "@/server/portal/leases";
import { listMySignatures } from "@/server/signatures/queries";
import { requirePortalCtx } from "@/server/portal/page-guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.lease");
  return { title: t("title") };
}

/** A tenant's lease: rent account, quittances, inspection reports, online payment. */
export default async function PortalLeasePage({
  params,
}: PageProps<"/[locale]/portal/leases/[leaseId]">) {
  const { locale: raw, leaseId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePortalCtx();
  const lease = await getPortalLease(ctx, leaseId);
  if (!lease) notFound();
  const signed = await listMySignatures(
    ctx,
    "lease_inspection",
    lease.inspections.map((i) => i.id),
  );
  const t = await getTranslations("portal.lease");
  const tr = await getTranslations("rentals");
  const tm = await getTranslations("payments.method");
  const tps = await getTranslations("portal.sale");
  const tpay = await getTranslations("portal.pay");
  const options = await getPortalPaymentOptions(ctx);
  const offer =
    options?.rent && lease.status === "active" ? onlinePaymentOffer(lease.statement) : null;
  const money = (v: bigint) => formatDZD(v, locale);
  const { statement } = lease;

  return (
    <div className="space-y-6">
      <Link
        href="/portal"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {tps("back")}
      </Link>
      <div className="space-y-1">
        <h1 className="text-large-title">
          {lease.projectName} · <bdi dir="ltr">{lease.unitCode}</bdi>
        </h1>
        <p className="text-sm text-muted-foreground">
          <bdi dir="ltr">{lease.number}</bdi> · {tr(`kind.${lease.kind}`)} ·{" "}
          {tr("termLine", {
            from: formatDate(lease.startOn),
            to: formatDate(lease.endedOn ?? lease.endOn),
            months: lease.durationMonths,
          })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("rentLine", {
            rent: money(lease.inForce.monthlyRent),
            frequency: tr(`frequency.${lease.frequency}`),
          })}
          {lease.inForce.monthlyCharges > 0n
            ? ` · ${t("chargesLine", { charges: money(lease.inForce.monthlyCharges) })}`
            : ""}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="portal-rent">
        {(
          [
            ["total", statement.price],
            ["paid", statement.paid],
            ["remaining", statement.remaining],
            ["overdue", statement.overdue],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-md border bg-card p-3">
            <dt className="text-muted-foreground">{tr(`totals.${key}`)}</dt>
            <dd
              className={cn(
                "font-semibold tabular-nums",
                key === "overdue" && value > 0n && "text-danger",
              )}
            >
              <bdi dir="ltr">{money(value)}</bdi>
            </dd>
          </div>
        ))}
      </dl>

      {offer && options ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3"
          data-testid="portal-pay-online"
        >
          <p className="text-sm text-muted-foreground">{tpay("introRent")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/portal/payments"
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              {tpay("history")}
            </Link>
            <PayOnlineDialog
              purpose="rent"
              targetId={lease.id}
              suggested={formatAmountInput(offer.suggested)}
              remaining={money(offer.remaining)}
              test={options.environment === "test"}
            />
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("schedule")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl bg-card shadow-card in-data-[slot=card]:border in-data-[slot=card]:shadow-none">
            <Table data-testid="portal-rent-schedule">
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("columns.period")}</TableHead>
                  <TableHead>{t("dueOn")}</TableHead>
                  <TableHead className="text-end">{tr("columns.amount")}</TableHead>
                  <TableHead className="text-end">{t("remaining")}</TableHead>
                  <TableHead>{tr("columns.state")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.lines.map((line) => (
                  <TableRow key={line.position}>
                    <TableCell className="whitespace-normal">
                      {line.settlementYear === undefined
                        ? `${formatDate(line.fromOn)} → ${formatDate(line.toOn)}`
                        : tr("settlement.line", { year: line.settlementYear })}
                    </TableCell>
                    <TableCell>{line.dueOn ? formatDate(line.dueOn) : "—"}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(line.amount)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(line.remaining)}
                    </TableCell>
                    <TableCell>
                      <InstallmentStateBadge state={line.state} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tps("payments")}</CardTitle>
        </CardHeader>
        <CardContent>
          {lease.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tps("noPayments")}</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="portal-rent-payments">
              {lease.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <span className="font-medium tabular-nums">
                      <bdi dir="ltr">{money(p.amount)}</bdi>
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {formatDate(p.paidOn)} · {tm(p.method)}
                      {p.kind === "deposit" ? ` · ${t("deposit")}` : ""}
                    </span>
                    {p.method === "cheque" && !p.chequeClearedOn ? (
                      <Badge variant="outline" className="ms-2">
                        {tps("chequePending")}
                      </Badge>
                    ) : null}
                  </div>
                  <PortalDocument
                    fileId={p.pdfFileId}
                    label={t("quittance", { number: p.receiptNumber })}
                  />
                </li>
              ))}
            </ul>
          )}
          {lease.deposit > 0n ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("depositLine", { held: money(lease.depositHeld), deposit: money(lease.deposit) })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {lease.inspections.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("inspections")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lease.inspections.map((i) => {
              const label = t(`inspection.${i.kind}`, { date: formatDate(i.inspectedOn) });
              return (
                <div key={i.id} className="flex flex-wrap items-center gap-2">
                  <PortalDocument fileId={i.pdfFileId} label={label} />
                  <SignDocument
                    documentType="lease_inspection"
                    documentId={i.id}
                    fileId={i.pdfFileId}
                    label={label}
                    signedAt={signed.get(i.id) ?? null}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
