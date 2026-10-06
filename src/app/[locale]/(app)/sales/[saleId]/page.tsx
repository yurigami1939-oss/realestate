import { KeyRound, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { DeliveryStateBadge } from "@/components/handovers/badges";
import { InstallmentStateBadge, SaleStatusBadge } from "@/components/sales/badges";
import { IssueCertificateDialog } from "@/components/certificates/issue-certificate-dialog";
import { DocumentPdf, PendingDocumentsRefresher } from "@/components/sales/document-pdf";
import { VspWarnings } from "@/components/sales/vsp-warnings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { certificateKinds } from "@/lib/certificates";
import { addDays, formatDate, formatDateTime, todayInAlgiers } from "@/lib/dates";
import { formatDZD, toDecimalString } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { formatPhone } from "@/lib/phone";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listBuyerOptions } from "@/server/buyers/queries";
import { listSaleReminders } from "@/server/collections/queries";
import { REMINDER_PAY_WITHIN_DAYS } from "@/server/collections/schemas";
import { getDelivery } from "@/server/handovers/queries";
import { listSalePaymentCalls } from "@/server/payment-calls/queries";
import { listSaleCertificates } from "@/server/certificates/queries";
import { listSalePayments } from "@/server/payments/queries";
import { listAccountChoices } from "@/server/treasury/queries";
import { getSalesSettings } from "@/server/organizations/settings";
import { listSaleBankLoans } from "@/server/sales/bank-loans";
import { listReservableUnits } from "@/server/sales/queries";
import { getSale } from "@/server/sales/sale-queries";
import { listSaleWithdrawals } from "@/server/sales/withdrawals";

import {
  CancelPaymentDialog,
  ClearChequeDialog,
  ContractDialog,
  RecordPaymentDialog,
  RecordSaleDialog,
  ReminderDialog,
} from "./_components/sale-dialogs";
import {
  BankLoanDialog,
  DecideWithdrawalDialog,
  ProposeWithdrawalDialog,
  SwapUnitDialog,
  TransferDialog,
  WithdrawalRefundDialog,
} from "./_components/after-sale";
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
  const reminders = await listSaleReminders(ctx, saleId);
  const withdrawals = await listSaleWithdrawals(ctx, saleId);
  const { loans, disbursed } = await listSaleBankLoans(ctx, saleId);
  const certificates = await listSaleCertificates(ctx, saleId);
  const accounts = can(ctx.roles, "payment:create") ? await listAccountChoices(ctx) : [];
  const changeable = sale.status === "reserved" && can(ctx.roles, "sale:update");
  const buyerChoices = changeable
    ? (await listBuyerOptions(ctx)).map((b) => ({
        id: b.id,
        label: `${b.lastName} ${b.firstName} · ${formatPhone(b.phone)}`,
      }))
    : [];
  const swapUnits = changeable
    ? (await listReservableUnits(ctx)).filter(
        (u) =>
          u.projectId === sale.projectId &&
          u.id !== sale.unitId &&
          (u.option === null || u.option.leadId === sale.leadId),
      )
    : [];
  const { withdrawalRetentionBp } = await getSalesSettings(ctx);
  const delivery =
    sale.status === "sold" && can(ctx.roles, "handover:read")
      ? await getDelivery(ctx, saleId)
      : null;
  const openWithdrawal = withdrawals.find((w) => w.status !== "rejected");
  const canProposeWithdrawal =
    sale.status === "reserved" && !openWithdrawal && can(ctx.roles, "sale:withdraw");
  const showWithdrawals = withdrawals.length > 0 || canProposeWithdrawal;
  const followedLoan = loans.find((l) => l.status !== "refused" && l.status !== "cancelled");
  /** Money as typed in amount inputs ("8000000,00"). */
  const moneyInput = (v: bigint) => toDecimalString(v).replace(".", ",");
  const t = await getTranslations();
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();
  const st = sale.statement;
  const live = sale.status !== "withdrawn";
  const canUpdate = live && can(ctx.roles, "sale:update");
  const showLoans = loans.length > 0 || canUpdate;
  const seesCommission =
    sale.commission !== null &&
    (can(ctx.roles, "commission:read_all") ||
      (can(ctx.roles, "commission:read") && sale.commission.userId === ctx.userId));
  const canCertify = live && can(ctx.roles, "sale:certify");
  /** What the sale allows today: versements once something is paid, solde once nothing remains. */
  const certificateChoices = certificateKinds.filter(
    (kind) =>
      (kind !== "payments" || st.paid > 0n) && (kind !== "paid_in_full" || st.remaining === 0n),
  );
  const pendingDocuments =
    certificates.some((c) => c.pdfFileId === null) ||
    (live && sale.sheetFileId === null) ||
    payments.some((p) => p.receiptId !== null && p.receiptPdfFileId === null) ||
    calls.some((c) => c.pdfFileId === null) ||
    reminders.some((r) => r.pdfFileId === null);
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
                accounts={accounts}
              />
            ) : null}
            {sale.status === "reserved" && can(ctx.roles, "sale:sign") ? (
              <RecordSaleDialog
                reservationId={sale.id}
                notary={sale.reservationNotary ?? ""}
                today={today}
              />
            ) : null}
            {live && st.overdue > 0n && can(ctx.roles, "sale:remind") ? (
              <ReminderDialog
                reservationId={sale.id}
                overdue={st.overdue}
                payBy={addDays(today, REMINDER_PAY_WITHIN_DAYS)}
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
              {live ? null : (
                <Alert data-testid="sale-closed">
                  <AlertDescription>
                    {t("sales.withdrawnNotice", {
                      date: sale.endedOn ? formatDate(sale.endedOn) : "—",
                      paid: money(st.paid),
                    })}
                  </AlertDescription>
                </Alert>
              )}
              {live ? (
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
              ) : null}
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
                  {t("sales.statement.penalties")} : <bdi dir="ltr">{money(st.penalties)}</bdi>.{" "}
                  {t("sales.statement.penaltiesHint")}
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
                        <TableRow key={p.id} data-receipt={p.receiptNumber ?? p.legacyReceipt}>
                          <TableCell className="tabular-nums" dir="ltr">
                            {formatDate(p.paidOn)}
                          </TableCell>
                          <TableCell
                            className={
                              cancelled
                                ? "text-end text-muted-foreground tabular-nums line-through"
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
                            {p.receiptId !== null && p.receiptNumber !== null ? (
                              <DocumentPdf
                                fileId={p.receiptPdfFileId}
                                kind="receipt"
                                id={p.receiptId}
                                label={p.receiptNumber}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {p.legacyReceipt ? <bdi dir="ltr">{p.legacyReceipt}</bdi> : null}
                                <span className="block">{t("payments.imported")}</span>
                              </span>
                            )}
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
                                  receiptNumber={p.receiptNumber ?? p.legacyReceipt ?? ""}
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
                      <TableHead className="text-end">{t("paymentCalls.columns.called")}</TableHead>
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

          {certificates.length > 0 || canCertify ? (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{t("certificates.title")}</CardTitle>
                {canCertify ? (
                  <IssueCertificateDialog reservationId={sale.id} kinds={certificateChoices} />
                ) : null}
              </CardHeader>
              <CardContent>
                {certificates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("certificates.empty")}</p>
                ) : (
                  <ul className="space-y-2 text-sm" data-testid="sale-certificates">
                    {certificates.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <DocumentPdf
                          fileId={c.pdfFileId}
                          kind="certificate"
                          id={c.id}
                          label={`${t(`certificates.kind.${c.kind}`)} · ${c.number}`}
                        />
                        <span className="text-muted-foreground">
                          <span dir="ltr">{formatDate(c.issuedAt)}</span> ·{" "}
                          {c.fromPortal
                            ? t("certificates.fromPortal")
                            : t("certificates.by", { name: c.issuedByName })}
                          {c.addressee ? (
                            <>
                              {" · "}
                              <bdi>{c.addressee}</bdi>
                            </>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
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
                    deliveryDueOn={sale.deliveryDueOn}
                    guaranteeNumber={sale.guaranteeNumber}
                    guaranteeIssuedOn={sale.guaranteeIssuedOn}
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
              {reminders.length > 0 ? (
                <>
                  <Separator />
                  <div className="space-y-1" data-testid="sale-reminders">
                    <div className="text-sm font-medium">{t("collections.reminders.title")}</div>
                    {reminders.map((r) => (
                      <div key={r.id} className="text-sm">
                        <DocumentPdf
                          fileId={r.pdfFileId}
                          kind="reminder_letter"
                          id={r.id}
                          label={t("collections.reminders.line", {
                            date: formatDate(r.issuedAt),
                            amount: money(r.overdue),
                            name: r.issuedByName,
                          })}
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          {live ? (
            <Card data-testid="sale-obligations">
              <CardHeader>
                <CardTitle className="text-base">{t("sales.obligations.title")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="space-y-2">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {t("sales.obligations.deliveryDueOn")}
                    </dt>
                    <dd className="text-end tabular-nums" dir="ltr">
                      {sale.deliveryDueOn
                        ? formatDate(sale.deliveryDueOn)
                        : t("sales.obligations.none")}
                    </dd>
                  </div>
                  {sale.obligations.daysLate > 0 ? (
                    <div className="flex justify-between gap-3 text-red-800">
                      <dt>{t("sales.obligations.late")}</dt>
                      <dd className="text-end">
                        {t("sales.obligations.days", { days: sale.obligations.daysLate })}
                      </dd>
                    </div>
                  ) : null}
                  {sale.obligations.penalty > 0n ? (
                    <div className="flex justify-between gap-3 text-red-800">
                      <dt>{t("sales.obligations.penalty")}</dt>
                      <dd className="text-end tabular-nums" dir="ltr">
                        {money(sale.obligations.penalty)}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t("sales.obligations.guarantee")}</dt>
                    <dd className="text-end">
                      {sale.guaranteeNumber ? (
                        sale.guaranteeIssuedOn ? (
                          t("sales.obligations.guaranteeOn", {
                            number: sale.guaranteeNumber,
                            date: formatDate(sale.guaranteeIssuedOn),
                          })
                        ) : (
                          t("sales.obligations.guaranteeValue", { number: sale.guaranteeNumber })
                        )
                      ) : sale.status === "sold" ? (
                        <span className="text-amber-800">
                          {t("sales.obligations.guaranteeMissing")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  {sale.obligations.warranties ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">
                          {t("sales.obligations.completion")}
                        </dt>
                        <dd className="text-end">
                          {t("sales.obligations.until", {
                            date: formatDate(sale.obligations.warranties.completion),
                          })}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{t("sales.obligations.tenYear")}</dt>
                        <dd className="text-end">
                          {t("sales.obligations.until", {
                            date: formatDate(sale.obligations.warranties.tenYear),
                          })}
                        </dd>
                      </div>
                    </>
                  ) : null}
                </dl>
                <ScanUpload
                  reservationId={sale.id}
                  kind="guarantee"
                  label={t("sales.fields.guaranteeNumber")}
                  fileId={sale.guaranteeScanFileId}
                  fileName={sale.guaranteeFileName}
                  editable={canUpdate}
                />
              </CardContent>
            </Card>
          ) : null}

          {showWithdrawals || showLoans || changeable ? (
            <Card data-testid="after-sale">
              <CardHeader>
                <CardTitle className="text-base">{t("sales.sections.afterSale")}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y text-sm">
                {showWithdrawals ? (
                  <div className="space-y-2 py-3 first:pt-0 last:pb-0" data-testid="withdrawals">
                    <div className="font-medium">{t("sales.withdrawal.title")}</div>
                    {withdrawals.map((w) => (
                      <div key={w.id} className="space-y-1 rounded-md border p-2">
                        <Badge variant="outline">{t(`sales.withdrawal.status.${w.status}`)}</Badge>
                        <div className="text-muted-foreground">
                          {t("sales.withdrawal.summary", {
                            paid: money(w.paid),
                            rate: formatShare(w.retentionBp),
                            retention: money(w.retention),
                            refund: money(w.refund),
                          })}
                        </div>
                        <div className="whitespace-pre-line">{w.reason}</div>
                        {w.decisionNote ? (
                          <div className="text-muted-foreground">{w.decisionNote}</div>
                        ) : null}
                        {w.status === "approved" && w.refund > 0n ? (
                          w.refundedOn ? (
                            <div className="text-emerald-800">
                              {t("sales.withdrawal.refundDone", { date: formatDate(w.refundedOn) })}
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-amber-800">
                                {t("sales.withdrawal.refundPending")}
                              </span>
                              {can(ctx.roles, "payment:create") ? (
                                <WithdrawalRefundDialog
                                  withdrawalId={w.id}
                                  refund={w.refund}
                                  today={today}
                                />
                              ) : null}
                            </div>
                          )
                        ) : null}
                        {w.status === "proposed" && can(ctx.roles, "sale:approve") ? (
                          <div className="flex flex-wrap gap-2">
                            <DecideWithdrawalDialog withdrawalId={w.id} approve refund={w.refund} />
                            <DecideWithdrawalDialog
                              withdrawalId={w.id}
                              approve={false}
                              refund={w.refund}
                            />
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {canProposeWithdrawal ? (
                      <ProposeWithdrawalDialog
                        reservationId={sale.id}
                        paid={st.paid}
                        defaultRetention={formatShare(withdrawalRetentionBp).slice(0, -2)}
                      />
                    ) : null}
                  </div>
                ) : null}
                {showLoans ? (
                  <>
                    <div className="space-y-2 py-3 first:pt-0 last:pb-0" data-testid="bank-loans">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{t("sales.loan.title")}</span>
                        {live && can(ctx.roles, "sale:update") ? (
                          <BankLoanDialog
                            reservationId={sale.id}
                            loan={
                              followedLoan
                                ? {
                                    id: followedLoan.id,
                                    bank: followedLoan.bank,
                                    requested: moneyInput(followedLoan.requested),
                                    approved:
                                      followedLoan.approved === null
                                        ? ""
                                        : moneyInput(followedLoan.approved),
                                    status: followedLoan.status,
                                    submittedOn: followedLoan.submittedOn ?? "",
                                    decidedOn: followedLoan.decidedOn ?? "",
                                    reference: followedLoan.reference ?? "",
                                    notes: followedLoan.notes ?? "",
                                  }
                                : null
                            }
                          />
                        ) : null}
                      </div>
                      {loans.map((l) => (
                        <div key={l.id} className="space-y-0.5">
                          <div>
                            {t("sales.loan.line", { bank: l.bank, requested: money(l.requested) })}{" "}
                            <Badge variant="outline">{t(`sales.loan.statuses.${l.status}`)}</Badge>
                          </div>
                          {l.approved !== null ? (
                            <div className="text-muted-foreground">
                              {t("sales.loan.approvedLine", { approved: money(l.approved) })}
                            </div>
                          ) : null}
                          {l.reference ? (
                            <div className="text-muted-foreground" dir="auto">
                              {l.reference}
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {disbursed > 0n ? (
                        <div className="text-muted-foreground">
                          {t("sales.loan.disbursed", { amount: money(disbursed) })}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
                {changeable ? (
                  <>
                    <div className="flex flex-wrap gap-2 py-3 first:pt-0 last:pb-0">
                      <TransferDialog
                        reservationId={sale.id}
                        buyers={buyerChoices}
                        current={sale.buyers.map((b) => b.id)}
                        today={today}
                      />
                      {swapUnits.length > 0 ? (
                        <SwapUnitDialog
                          reservationId={sale.id}
                          units={swapUnits}
                          paid={st.paid}
                          canDiscount={can(ctx.roles, "sale:discount")}
                          today={today}
                        />
                      ) : null}
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {delivery ? (
            <Card data-testid="sale-delivery">
              <CardHeader>
                <CardTitle className="text-base">{t("handovers.card.title")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <DeliveryStateBadge state={delivery.state} />
                {delivery.handover?.number && delivery.handover.signedOn ? (
                  <div className="text-muted-foreground">
                    {t("handovers.pvOn", {
                      number: delivery.handover.number,
                      date: formatDate(delivery.handover.signedOn),
                    })}
                  </div>
                ) : delivery.handover?.scheduledAt ? (
                  <div className="text-muted-foreground">
                    {t("handovers.appointmentAt", {
                      date: formatDateTime(delivery.handover.scheduledAt),
                    })}
                  </div>
                ) : null}
                <Button asChild variant="outline" size="sm">
                  <Link href={`/deliveries/${sale.id}`}>
                    <KeyRound data-icon="inline-start" />
                    {t("handovers.card.open")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

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
