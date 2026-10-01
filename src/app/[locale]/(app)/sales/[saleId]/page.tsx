import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { InstallmentStateBadge, SaleStatusBadge } from "@/components/sales/badges";
import { DocumentPdf, PendingDocumentsRefresher } from "@/components/sales/document-pdf";
import { VspWarnings } from "@/components/sales/vsp-warnings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import { formatDZD } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listSalePaymentCalls } from "@/server/payment-calls/queries";
import { listSalePayments } from "@/server/payments/queries";
import { getSale } from "@/server/sales/sale-queries";

import {
  CancelPaymentDialog,
  ClearChequeDialog,
  ContractDialog,
  RecordPaymentDialog,
  RecordSaleDialog,
} from "./_components/sale-dialogs";
import { ScanUpload } from "./_components/scan-upload";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/sales/[saleId]">): Promise<Metadata> {
  const ctx = await requirePermission("sale:read");
  const sale = await getSale(ctx, (await params).saleId);
  return { title: sale?.number };
}

export default async function SalePage({ params }: PageProps<"/[locale]/sales/[saleId]">) {
  const { locale: raw, saleId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("sale:read");
  const sale = await getSale(ctx, saleId);
  if (!sale) notFound();
  const payments = await listSalePayments(ctx, saleId);
  const calls = await listSalePaymentCalls(ctx, saleId);
  const t = await getTranslations();
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();
  const st = sale.statement;
  const live = sale.status !== "withdrawn";
  const canUpdate = live && can(ctx.roles, "sale:update");
  const seesCommission =
    sale.commission !== null &&
    (can(ctx.roles, "commission:read_all") ||
      (can(ctx.roles, "commission:read") && sale.commission.userId === ctx.userId));
  const pendingDocuments =
    (live && sale.sheetFileId === null) ||
    payments.some((p) => p.receiptPdfFileId === null) ||
    calls.some((c) => c.pdfFileId === null);
  const mainBuyer = sale.buyers[0];

  const summary: { label: string; value: React.ReactNode }[] = [
    {
      label: t("sales.detail.unit"),
      value: (
        <Link
          href={`/projects/${sale.projectId}/units/${sale.unitId}`}
          className="font-medium hover:underline"
        >
          <bdi dir="ltr">{sale.unitCode}</bdi>
          {sale.unitTypology ? ` · ${sale.unitTypology}` : ""}
        </Link>
      ),
    },
    { label: t("sales.detail.project"), value: `${sale.projectName} · ${sale.buildingName}` },
    { label: t("sales.detail.listPrice"), value: <bdi dir="ltr">{money(sale.listPrice)}</bdi> },
    ...(sale.discount > 0n
      ? [
          {
            label: t("sales.detail.discount"),
            value: <bdi dir="ltr">− {money(sale.discount)}</bdi>,
          },
        ]
      : []),
    {
      label: t("sales.detail.price"),
      value: (
        <bdi dir="ltr" className="font-semibold">
          {money(sale.price)}
        </bdi>
      ),
    },
    { label: t("sales.detail.reservedOn"), value: formatDate(sale.reservedOn) },
    { label: t("sales.detail.plan"), value: sale.planName ?? "—" },
    { label: t("sales.detail.commercial"), value: sale.commercialName ?? "—" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PendingDocumentsRefresher pending={pendingDocuments} />
      <PageHeader
        title={t("sales.detail.title", { number: sale.number })}
        description={`${sale.projectName} · ${sale.buildingName} · ${sale.unitCode}`}
        crumbs={[{ label: t("sales.title"), href: "/sales" }]}
        badge={<SaleStatusBadge status={sale.status} />}
        actions={
          <>
            {live && st.remaining > 0n && can(ctx.roles, "payment:create") ? (
              <RecordPaymentDialog
                reservationId={sale.id}
                number={sale.number}
                remaining={st.remaining}
                payerName={mainBuyer ? `${mainBuyer.firstName} ${mainBuyer.lastName}` : ""}
                today={today}
              />
            ) : null}
            {sale.status === "reserved" && can(ctx.roles, "sale:sign") ? (
              <RecordSaleDialog
                reservationId={sale.id}
                notary={sale.reservationNotary ?? ""}
                today={today}
              />
            ) : null}
          </>
        }
      />

      {sale.saleNumber && sale.saleSignedOn ? (
        <p className="text-sm text-muted-foreground" data-testid="vsp-signed">
          {t("sales.vsp.signed", {
            number: sale.saleNumber,
            date: formatDate(sale.saleSignedOn),
            notary: sale.saleNotary ?? "—",
          })}
        </p>
      ) : null}
      {sale.missingDocuments > 0 ? (
        <Alert data-testid="missing-documents">
          <TriangleAlert />
          <AlertTitle>{t("sales.missingDocuments", { count: sale.missingDocuments })}</AlertTitle>
          <AlertDescription>{t("sales.missingDocumentsHint")}</AlertDescription>
        </Alert>
      ) : null}
      <VspWarnings warnings={sale.vspWarnings} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("sales.sections.statement")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-3" data-testid="statement-totals">
                {(
                  [
                    ["price", st.price],
                    ["paid", st.paid],
                    ["remaining", st.remaining],
                    ["due", st.due],
                    ["overdue", st.overdue],
                    ["advance", st.advance],
                  ] as const
                ).map(([key, value]) => (
                  <div
                    key={key}
                    className={
                      key === "overdue" && value > 0n
                        ? "rounded-md border border-red-300 bg-red-50 p-2 text-red-900"
                        : "rounded-md border p-2"
                    }
                    data-total={key}
                  >
                    <dt className="text-muted-foreground">{t(`sales.statement.${key}`)}</dt>
                    <dd className="font-semibold tabular-nums" dir="ltr">
                      {money(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              <Table data-testid="sale-statement">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("sales.statement.columns.step")}</TableHead>
                    <TableHead>{t("sales.statement.columns.due")}</TableHead>
                    <TableHead className="text-end">
                      {t("sales.statement.columns.amount")}
                    </TableHead>
                    <TableHead className="text-end">{t("sales.statement.columns.paid")}</TableHead>
                    <TableHead className="text-end">
                      {t("sales.statement.columns.remaining")}
                    </TableHead>
                    <TableHead>{t("sales.statement.columns.state")}</TableHead>
                    {st.penalties > 0n ? (
                      <TableHead className="text-end">
                        {t("sales.statement.columns.penalty")}
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sale.installments.map((i) => {
                    const line = st.lines.find((l) => l.position === i.position);
                    return (
                      <TableRow key={i.position} data-position={i.position}>
                        <TableCell className="whitespace-normal">
                          {i.label}
                          <span className="block text-xs text-muted-foreground" dir="ltr">
                            {formatShare(i.shareBp)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {i.dueOn ? (
                            <span className="tabular-nums">{formatDate(i.dueOn)}</span>
                          ) : (
                            <span className="text-muted-foreground">{i.milestoneName ?? "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(i.amount)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(line?.paid ?? 0n)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(line?.remaining ?? i.amount)}
                        </TableCell>
                        <TableCell>
                          {line ? <InstallmentStateBadge state={line.state} /> : null}
                          {line && line.daysLate > 0 ? (
                            <span className="block text-xs text-red-800">
                              {t("sales.statement.daysLate", { days: line.daysLate })}
                            </span>
                          ) : null}
                        </TableCell>
                        {st.penalties > 0n ? (
                          <TableCell className="text-end tabular-nums" dir="ltr">
                            {line && line.penalty > 0n ? money(line.penalty) : "—"}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {st.penalties > 0n ? (
                <p className="text-sm text-muted-foreground">
                  {t("sales.statement.penalties")} :{" "}
                  <bdi dir="ltr">{money(st.penalties)}</bdi>. {t("sales.statement.penaltiesHint")}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("sales.sections.payments")}</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("payments.none")}</p>
              ) : (
                <Table data-testid="sale-payments">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("payments.columns.date")}</TableHead>
                      <TableHead className="text-end">{t("payments.columns.amount")}</TableHead>
                      <TableHead>{t("payments.columns.method")}</TableHead>
                      <TableHead>{t("payments.columns.receipt")}</TableHead>
                      <TableHead>{t("payments.columns.status")}</TableHead>
                      <TableHead>
                        <span className="sr-only">{t("common.actions")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => {
                      const cancelled = p.status === "cancelled";
                      const pendingCheque =
                        p.method === "cheque" && !cancelled && p.chequeClearedOn === null;
                      return (
                        <TableRow key={p.id} data-receipt={p.receiptNumber}>
                          <TableCell className="tabular-nums" dir="ltr">
                            {formatDate(p.paidOn)}
                          </TableCell>
                          <TableCell
                            className={
                              cancelled
                                ? "text-end tabular-nums text-muted-foreground line-through"
                                : "text-end tabular-nums"
                            }
                            dir="ltr"
                          >
                            {money(p.amount)}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {t(`payments.method.${p.method}`)}
                            {p.reference || p.bank ? (
                              <span className="block text-xs text-muted-foreground" dir="auto">
                                {[p.reference, p.bank].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <DocumentPdf
                              fileId={p.receiptPdfFileId}
                              kind="receipt"
                              id={p.receiptId}
                              label={p.receiptNumber}
                            />
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {cancelled ? (
                              <>
                                <Badge variant="outline" className="text-red-800">
                                  {t("payments.cancelled")}
                                </Badge>
                                <span className="block text-xs text-muted-foreground">
                                  {t("payments.cancelledBy", {
                                    reason: p.cancellationReason ?? "—",
                                  })}
                                </span>
                              </>
                            ) : pendingCheque ? (
                              <Badge variant="outline" className="text-amber-800">
                                {t("payments.pendingCheque")}
                              </Badge>
                            ) : p.chequeClearedOn ? (
                              <span className="text-xs text-muted-foreground">
                                {t("payments.chequeCleared", {
                                  date: formatDate(p.chequeClearedOn),
                                })}
                              </span>
                            ) : (
                              <Badge variant="outline" className="text-emerald-800">
                                {t("payments.valid")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap justify-end gap-1">
                              {pendingCheque && can(ctx.roles, "payment:create") ? (
                                <ClearChequeDialog paymentId={p.id} today={today} />
                              ) : null}
                              {!cancelled && can(ctx.roles, "payment:cancel") ? (
                                <CancelPaymentDialog
                                  paymentId={p.id}
                                  receiptNumber={p.receiptNumber}
                                />
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {calls.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("paymentCalls.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table data-testid="sale-payment-calls">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("paymentCalls.columns.number")}</TableHead>
                      <TableHead>{t("paymentCalls.columns.milestone")}</TableHead>
                      <TableHead className="text-end">
                        {t("paymentCalls.columns.called")}
                      </TableHead>
                      <TableHead>{t("paymentCalls.columns.dueOn")}</TableHead>
                      <TableHead>{t("paymentCalls.columns.issuedAt")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <DocumentPdf
                            fileId={c.pdfFileId}
                            kind="payment_call"
                            id={c.id}
                            label={c.number}
                          />
                        </TableCell>
                        <TableCell className="whitespace-normal">{c.milestoneName}</TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(c.called)}
                        </TableCell>
                        <TableCell className="tabular-nums" dir="ltr">
                          {formatDate(c.dueOn)}
                        </TableCell>
                        <TableCell className="tabular-nums" dir="ltr">
                          {formatDate(c.issuedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("sales.sections.summary")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm" data-testid="sale-summary">
                {summary.map((row) => (
                  <div key={row.label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="text-end">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("sales.sections.buyers")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {sale.buyers.map((b, index) => (
                <div key={b.id} className="text-sm">
                  <Link href={`/buyers/${b.id}`} className="font-medium hover:underline">
                    {b.lastName} {b.firstName}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {index === 0 ? t("sales.fields.mainBuyer") : t("sales.fields.coBuyer")}
                  </span>
                  <div className="text-muted-foreground">
                    <PhoneText value={b.phone} />
                    {b.nin ? (
                      <span dir="ltr" className="ms-2 tabular-nums">
                        NIN {b.nin}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("sales.sections.documents")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <div className="text-sm font-medium">{t("sales.sheet")}</div>
                <DocumentPdf
                  fileId={sale.sheetFileId}
                  kind="reservation_sheet"
                  id={sale.id}
                  label={`${sale.number}.pdf`}
                />
              </div>
              <Separator />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm">
                  <div className="font-medium">{t("sales.contract.title")}</div>
                  <div className="text-muted-foreground">
                    {sale.reservationNotary
                      ? t("sales.notaryRef", { notary: sale.reservationNotary })
                      : t("sales.contract.none")}
                    {sale.reservationReference ? ` · ${sale.reservationReference}` : ""}
                  </div>
                </div>
                {canUpdate ? (
                  <ContractDialog
                    reservationId={sale.id}
                    notary={sale.reservationNotary}
                    reference={sale.reservationReference}
                  />
                ) : null}
              </div>
              <ScanUpload
                reservationId={sale.id}
                kind="contract"
                label={t("sales.contractScan")}
                fileId={sale.reservationScanFileId}
                fileName={sale.scanFileName}
                editable={canUpdate}
              />
              {sale.status === "sold" ? (
                <ScanUpload
                  reservationId={sale.id}
                  kind="deed"
                  label={t("sales.deedScan")}
                  fileId={sale.saleScanFileId}
                  fileName={sale.deedFileName}
                  editable={canUpdate}
                />
              ) : null}
            </CardContent>
          </Card>

          {seesCommission && sale.commission ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("sales.sections.commission")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm" data-testid="sale-commission">
                <div>
                  {t("sales.commission.line", {
                    name: sale.commercialName ?? "—",
                    rate: formatShare(sale.commission.rateBp),
                    amount: money(sale.commission.amount),
                  })}
                </div>
                <Badge variant="outline">
                  {t(`sales.commission.status.${sale.commission.status}`)}
                </Badge>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
