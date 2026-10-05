import { AlertCircle, ArrowLeft, CheckCircle2, Clock, RotateCcw, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CardsMark, TestModeBadge } from "@/components/online-payments/badges";
import {
  PrintPage,
  RefreshOnlinePayment,
} from "@/components/online-payments/payment-result-actions";
import { PortalDocument } from "@/components/portal/portal-document";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { type OnlinePaymentStatus, SATIM_HELP_NUMBER } from "@/lib/online-payments";
import { cn } from "@/lib/utils";
import { getPortalOnlinePayment } from "@/server/online-payments/queries";
import { requirePortalCtx } from "@/server/portal/page-guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.pay.result");
  return { title: t("title") };
}

const statusLook: Record<OnlinePaymentStatus, { icon: typeof CheckCircle2; className: string }> = {
  paid: { icon: CheckCircle2, className: "text-emerald-700" },
  pending: { icon: Clock, className: "text-amber-700" },
  created: { icon: AlertCircle, className: "text-zinc-600" },
  failed: { icon: XCircle, className: "text-red-700" },
  expired: { icon: XCircle, className: "text-zinc-600" },
  refunded: { icon: RotateCcw, className: "text-sky-700" },
};

/**
 * Where the payer lands after the gateway (CLAUDE.md §7 Online payment): the outcome, SATIM's
 * message, the transaction's details and the receipt, printable; SATIM's help line.
 */
export default async function PortalOnlinePaymentPage({
  params,
}: PageProps<"/[locale]/portal/payments/[paymentId]">) {
  const { locale: raw, paymentId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePortalCtx();
  const payment = await getPortalOnlinePayment(ctx, paymentId);
  if (!payment) notFound();
  const t = await getTranslations("portal.pay.result");
  const money = (v: bigint) => formatDZD(v, locale);
  const look = statusLook[payment.status];
  const object =
    payment.purpose === "sale"
      ? `${payment.projectName ?? ""} · ${payment.unitCode ?? ""}`
      : `${payment.residenceName ?? ""} · ${payment.unitCode ?? ""}`;
  const back =
    payment.purpose === "sale"
      ? `/portal/sales/${payment.reservationId ?? ""}`
      : `/portal/units/${payment.unitId ?? ""}`;
  const receiptNumber = payment.receiptNumber ?? payment.chargeReceiptNumber;
  const receiptFileId = payment.receiptFileId ?? payment.chargeReceiptFileId;
  const details: [string, string | null][] = [
    [t("order"), payment.orderNumber],
    [t("transaction"), payment.gatewayOrderId],
    [t("approval"), payment.approvalCode],
    [t("amount"), money(payment.amount)],
    [t("date"), formatDateTime(payment.paidAt ?? payment.createdAt)],
    [t("card"), payment.cardPan],
    [t("method"), t("methodValue")],
  ];

  return (
    <div className="space-y-6">
      <Link
        href={back}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("back")}
      </Link>
      <div className="space-y-2" data-testid="online-payment-result" data-status={payment.status}>
        <div className="flex flex-wrap items-center gap-2">
          <look.icon className={cn("size-7", look.className)} aria-hidden />
          <h1 className="text-2xl font-semibold">{t(payment.status)}</h1>
          {payment.environment === "test" ? <TestModeBadge /> : null}
        </div>
        <p className="text-muted-foreground">
          {payment.status === "paid" && payment.issue ? t("issue") : t(`${payment.status}Text`)}
        </p>
        {payment.gatewayMessage ? (
          <p className="text-sm" data-testid="online-payment-message">
            {t("gatewayMessage", { message: payment.gatewayMessage })}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">{t("details")}</CardTitle>
          <CardsMark />
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            <span className="text-muted-foreground">{t("object")} </span>
            {object}
          </p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {details
              .filter((entry): entry is [string, string] => entry[1] !== null)
              .map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b py-1">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums">
                    <bdi dir="ltr">{value}</bdi>
                  </dd>
                </div>
              ))}
          </dl>
          {receiptNumber ? (
            <PortalDocument
              fileId={receiptFileId}
              label={t("receipt", { number: receiptNumber })}
            />
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {payment.status === "pending" || payment.status === "created" ? (
          <RefreshOnlinePayment onlinePaymentId={payment.id} ask />
        ) : null}
        {payment.status === "paid" && receiptNumber && !receiptFileId ? (
          <RefreshOnlinePayment onlinePaymentId={payment.id} ask={false} />
        ) : null}
        {payment.status === "paid" ? <PrintPage /> : null}
        {payment.status === "failed" || payment.status === "expired" ? (
          <Link
            href={back}
            className="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            {t("retry")}
          </Link>
        ) : null}
        <Link
          href="/portal/payments"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          {t("all")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t("help", { number: SATIM_HELP_NUMBER })}</p>
    </div>
  );
}
