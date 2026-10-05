import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PayOnlineDialog } from "@/components/online-payments/pay-online-dialog";
import { PortalDocument } from "@/components/portal/portal-document";
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
import { requirePortalCtx } from "@/server/portal/page-guard";
import { getPortalUnitAccount } from "@/server/portal/residences";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.unit");
  return { title: t("title") };
}

/** A co-owner's charges account: calls, payments and receipts, reminder letters. */
export default async function PortalUnitPage({
  params,
}: PageProps<"/[locale]/portal/units/[unitId]">) {
  const { locale, unitId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePortalCtx();
  const account = await getPortalUnitAccount(ctx, unitId);
  if (!account) notFound();
  const t = await getTranslations("portal.unit");
  const tp = await getTranslations("charges.period");
  const tm = await getTranslations("payments.method");
  const tps = await getTranslations("portal.sale");
  const tpay = await getTranslations("portal.pay");
  const options = await getPortalPaymentOptions(ctx);
  const offer = options?.charges ? onlinePaymentOffer(account.statement) : null;
  const money = (v: bigint) => formatDZD(v, toLocale(locale));
  const { statement } = account;

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
        <h1 className="text-2xl font-semibold">
          {account.residenceName} · <bdi dir="ltr">{account.code}</bdi>
        </h1>
        <p className="text-sm text-muted-foreground">
          {[
            account.buildingName,
            account.typology,
            t("shares", { share: account.share, basis: account.shareBasis }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="portal-account">
        {(
          [
            ["called", statement.price],
            ["paid", statement.paid],
            ["remaining", statement.remaining],
            ["overdue", statement.overdue],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-md border bg-background p-3">
            <dt className="text-muted-foreground">{t(key)}</dt>
            <dd
              className={cn(
                "font-semibold tabular-nums",
                key === "overdue" && value > 0n && "text-red-700",
              )}
            >
              <bdi dir="ltr">{money(value)}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      {statement.credit > 0n ? (
        <p className="text-sm text-muted-foreground">
          {t("credit", { amount: money(statement.credit) })}
        </p>
      ) : null}

      {offer && options ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"
          data-testid="portal-pay-online"
        >
          <p className="text-sm text-muted-foreground">{tpay("introCharges")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/portal/payments"
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              {tpay("history")}
            </Link>
            <PayOnlineDialog
              purpose="charges"
              targetId={account.unitId}
              suggested={formatAmountInput(offer.suggested)}
              remaining={money(offer.remaining)}
              test={options.environment === "test"}
            />
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("calls")}</CardTitle>
        </CardHeader>
        <CardContent>
          {statement.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noCalls")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table data-testid="portal-calls">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("period")}</TableHead>
                    <TableHead>{t("dueOn")}</TableHead>
                    <TableHead className="text-end">{t("amount")}</TableHead>
                    <TableHead className="text-end">{t("remaining")}</TableHead>
                    <TableHead>{t("state")}</TableHead>
                    <TableHead>{t("document")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="whitespace-normal">
                        {tp(line.frequency, { year: line.year, index: line.periodIndex })}
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
                      <TableCell>
                        <PortalDocument fileId={line.pdfFileId} label={line.number} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tps("payments")}</CardTitle>
        </CardHeader>
        <CardContent>
          {account.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tps("noPayments")}</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="portal-charge-payments">
              {account.payments.map((p) => (
                <li
                  key={p.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 py-2",
                    p.status === "cancelled" && "opacity-60",
                  )}
                >
                  <div>
                    <span className="font-medium tabular-nums">
                      <bdi dir="ltr">{money(p.amount)}</bdi>
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {formatDate(p.paidOn)} · {tm(p.method)}
                    </span>
                    {p.status === "cancelled" ? (
                      <Badge variant="outline" className="ms-2">
                        {tps("cancelled")}
                      </Badge>
                    ) : p.method === "cheque" && !p.chequeClearedOn ? (
                      <Badge variant="outline" className="ms-2">
                        {tps("chequePending")}
                      </Badge>
                    ) : null}
                  </div>
                  <PortalDocument
                    fileId={p.pdfFileId}
                    label={tps("receipt", { number: p.receiptNumber })}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {account.reminders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("reminders")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {account.reminders.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <PortalDocument
                  fileId={r.pdfFileId}
                  label={tps("reminder", { date: formatDate(r.issuedAt) })}
                />
                <span className="text-sm text-muted-foreground">
                  <bdi dir="ltr">{money(r.overdue)}</bdi> ·{" "}
                  {tps("payBy", { date: formatDate(r.payBy) })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
