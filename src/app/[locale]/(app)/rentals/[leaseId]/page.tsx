import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { UnitStatusBadge } from "@/components/inventory/status";
import { InspectionDialog } from "@/components/rentals/inspection-dialog";
import {
  CancelRentPaymentDialog,
  ClearRentChequeDialog,
  EndLeaseDialog,
  RecordRentPaymentDialog,
  RenewLeaseDialog,
  ReviseRentDialog,
  SettleDepositDialog,
} from "@/components/rentals/lease-dialogs";
import { InspectionPdf, LeaseStateBadge, RentReceiptPdf } from "@/components/rentals/rentals-ui";
import { InstallmentStateBadge } from "@/components/sales/badges";
import { PendingDocumentsRefresher } from "@/components/sales/document-pdf";
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
import { addDays, formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD, toDecimalString } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getLease } from "@/server/rentals/queries";
import { listAccountChoices } from "@/server/treasury/queries";

import { ContractScan } from "./_components/contract-scan";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/rentals/[leaseId]">): Promise<Metadata> {
  const ctx = await requirePermission("lease:read");
  const lease = await getLease(ctx, (await params).leaseId);
  return { title: lease?.number };
}

/** Money as typed in amount inputs ("45000,00"); "" for zero optional amounts. */
const asInput = (v: bigint, optional = false) =>
  optional && v === 0n ? "" : toDecimalString(v).replace(".", ",");

/** A lease: its rent schedule and payments, the deposit, the tenant and the unit. */
export default async function LeasePage({ params }: PageProps<"/[locale]/rentals/[leaseId]">) {
  const { locale: raw, leaseId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("lease:read");
  const accounts = can(ctx.roles, "payment:create") ? await listAccountChoices(ctx) : [];
  const lease = await getLease(ctx, leaseId);
  if (!lease) notFound();
  const t = await getTranslations("rentals");
  const tp = await getTranslations("payments");
  const tc = await getTranslations("common");
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();
  const st = lease.statement;
  const active = lease.status === "active";
  const editable = active && can(ctx.roles, "lease:update");
  const canPay = can(ctx.roles, "payment:create");
  const depositMissing = lease.deposit - lease.depositHeld;
  const settleable =
    lease.status === "ended" &&
    lease.renewal === null &&
    lease.depositSettledOn === null &&
    lease.depositHeld > 0n &&
    can(ctx.roles, "lease:update");
  const pending =
    lease.payments.some((p) => p.pdfFileId === null) ||
    lease.inspections.some((i) => i.pdfFileId === null);
  const inspectionOf = (kind: "check_in" | "check_out") =>
    lease.inspections.find((i) => i.kind === kind) ?? null;
  const checkIn = inspectionOf("check_in");
  const checkOut = inspectionOf("check_out");
  const canInspect = can(ctx.roles, "lease:update");
  // A revision starts with a period after the first one and after the latest revision.
  const lastRevision = lease.revisions.at(-1)?.effectiveOn ?? lease.startOn;
  const revisable = st.lines.map((l) => l.fromOn).filter((day) => day > lastRevision);
  const revised =
    lease.inForce.monthlyRent !== lease.monthlyRent ||
    lease.inForce.monthlyCharges !== lease.monthlyCharges;

  const terms: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.signedOn"), value: formatDate(lease.signedOn) },
    {
      label: t("fields.term"),
      value: t("termLine", {
        from: formatDate(lease.startOn),
        to: formatDate(lease.endOn),
        months: lease.durationMonths,
      }),
    },
    { label: t("fields.monthlyRent"), value: <bdi dir="ltr">{money(lease.monthlyRent)}</bdi> },
    ...(lease.monthlyCharges > 0n
      ? [
          {
            label: t("fields.monthlyCharges"),
            value: <bdi dir="ltr">{money(lease.monthlyCharges)}</bdi>,
          },
        ]
      : []),
    ...(revised
      ? [
          {
            label: t("revisions.inForce"),
            value: (
              <bdi dir="ltr">
                {money(lease.inForce.monthlyRent)}
                {lease.inForce.monthlyCharges > 0n
                  ? ` + ${money(lease.inForce.monthlyCharges)}`
                  : ""}
              </bdi>
            ),
          },
        ]
      : []),
    { label: t("fields.frequency"), value: t(`frequency.${lease.frequency}`) },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PendingDocumentsRefresher pending={pending} />
      <PageHeader
        title={t("detailTitle", { number: lease.number })}
        description={`${lease.projectName} · ${lease.buildingName} · ${lease.unitCode}`}
        crumbs={[{ label: t("title"), href: "/rentals" }]}
        badge={<LeaseStateBadge state={lease.state} />}
        actions={
          <>
            {canPay && st.remaining > 0n ? (
              <RecordRentPaymentDialog
                leaseId={lease.id}
                kind="rent"
                max={st.remaining}
                payerName={lease.tenantName}
                today={today}
                accounts={accounts}
              />
            ) : null}
            {canPay && active && depositMissing > 0n ? (
              <RecordRentPaymentDialog
                leaseId={lease.id}
                kind="deposit"
                max={depositMissing}
                payerName={lease.tenantName}
                today={today}
                accounts={accounts}
              />
            ) : null}
            {editable ? (
              <>
                <Button asChild variant="outline">
                  <Link href={`/rentals/${lease.id}/edit`}>
                    <Pencil data-icon="inline-start" />
                    {tc("edit")}
                  </Link>
                </Button>
                <RenewLeaseDialog
                  leaseId={lease.id}
                  startOn={formatDate(addDays(lease.endOn, 1))}
                  today={today}
                  defaults={{
                    durationMonths: String(lease.durationMonths),
                    monthlyRent: asInput(lease.inForce.monthlyRent),
                    monthlyCharges: asInput(lease.inForce.monthlyCharges, true),
                    frequency: lease.frequency,
                    deposit: asInput(lease.deposit, true),
                  }}
                />
                {revisable.length > 0 ? (
                  <ReviseRentDialog
                    leaseId={lease.id}
                    periods={[
                      ...revisable.filter((day) => day >= today),
                      ...revisable.filter((day) => day < today).reverse(),
                    ]}
                    current={lease.inForce}
                  />
                ) : null}
                <EndLeaseDialog leaseId={lease.id} today={today} />
              </>
            ) : null}
          </>
        }
      />

      {lease.renewedFrom ? (
        <p className="text-sm text-muted-foreground">
          {t("renews")}{" "}
          <Link href={`/rentals/${lease.renewedFrom.id}`} className="hover:underline">
            <bdi dir="ltr">{lease.renewedFrom.number}</bdi>
          </Link>
        </p>
      ) : null}
      {lease.status === "ended" ? (
        <p className="text-sm text-muted-foreground" data-testid="lease-ended">
          {lease.renewal ? (
            <>
              {t("renewedBy")}{" "}
              <Link href={`/rentals/${lease.renewal.id}`} className="hover:underline">
                <bdi dir="ltr">{lease.renewal.number}</bdi>
              </Link>
            </>
          ) : (
            t("endedLine", {
              date: lease.endedOn ? formatDate(lease.endedOn) : "—",
              reason: lease.endReason ?? "—",
            })
          )}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("schedule")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-4" data-testid="rent-totals">
                {(
                  [
                    ["total", st.price],
                    ["paid", st.paid],
                    ["remaining", st.remaining],
                    ["overdue", st.overdue],
                  ] as const
                ).map(([key, value]) => (
                  <div
                    key={key}
                    className={
                      key === "overdue" && value > 0n
                        ? "rounded-md border border-red-300 bg-red-50 p-2 text-red-900"
                        : "rounded-md border p-2"
                    }
                  >
                    <dt className="text-muted-foreground">{t(`totals.${key}`)}</dt>
                    <dd className="font-semibold tabular-nums" dir="ltr">
                      {money(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="overflow-x-auto">
                <Table data-testid="rent-schedule">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.period")}</TableHead>
                      <TableHead className="text-end">{t("columns.amount")}</TableHead>
                      <TableHead className="text-end">{t("columns.paid")}</TableHead>
                      <TableHead>{t("columns.state")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {st.lines.map((line) => (
                      <TableRow key={line.position}>
                        <TableCell className="whitespace-normal">
                          {formatDate(line.fromOn)} → {formatDate(line.toOn)}
                          <span className="block text-xs text-muted-foreground">
                            {t("monthsCount", { count: line.months })}
                          </span>
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(line.amount)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(line.paid)}
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
              <CardTitle className="text-base">{t("payments")}</CardTitle>
            </CardHeader>
            <CardContent>
              {lease.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tp("none")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table data-testid="rent-payments">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tp("columns.date")}</TableHead>
                        <TableHead>{t("columns.kind")}</TableHead>
                        <TableHead className="text-end">{tp("columns.amount")}</TableHead>
                        <TableHead>{tp("columns.method")}</TableHead>
                        <TableHead>{tp("columns.receipt")}</TableHead>
                        <TableHead>{tp("columns.status")}</TableHead>
                        <TableHead>
                          <span className="sr-only">{tc("actions")}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lease.payments.map((p) => {
                        const cancelled = p.status === "cancelled";
                        const pendingCheque =
                          p.method === "cheque" && !cancelled && p.chequeClearedOn === null;
                        return (
                          <TableRow key={p.id} data-receipt={p.receiptNumber}>
                            <TableCell>{formatDate(p.paidOn)}</TableCell>
                            <TableCell>{t(`paymentKind.${p.kind}`)}</TableCell>
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
                              {tp(
                                `method.${p.method === "bank_loan" ? "bank_transfer" : p.method}`,
                              )}
                              {p.reference || p.bank ? (
                                <span className="block text-xs text-muted-foreground" dir="auto">
                                  {[p.reference, p.bank].filter(Boolean).join(" · ")}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <RentReceiptPdf
                                fileId={p.pdfFileId}
                                paymentId={p.id}
                                label={p.receiptNumber}
                              />
                            </TableCell>
                            <TableCell className="whitespace-normal">
                              {cancelled ? (
                                <>
                                  <Badge variant="outline" className="text-red-800">
                                    {tp("cancelled")}
                                  </Badge>
                                  <span className="block text-xs text-muted-foreground">
                                    {tp("cancelledBy", { reason: p.cancellationReason ?? "—" })}
                                  </span>
                                </>
                              ) : pendingCheque ? (
                                <Badge variant="outline" className="text-amber-800">
                                  {tp("pendingCheque")}
                                </Badge>
                              ) : p.chequeClearedOn ? (
                                <span className="text-xs text-muted-foreground">
                                  {tp("chequeCleared", { date: formatDate(p.chequeClearedOn) })}
                                </span>
                              ) : (
                                <Badge variant="outline" className="text-emerald-800">
                                  {tp("valid")}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap justify-end gap-1">
                                {pendingCheque && canPay ? (
                                  <ClearRentChequeDialog paymentId={p.id} today={today} />
                                ) : null}
                                {!cancelled && can(ctx.roles, "payment:cancel") ? (
                                  <CancelRentPaymentDialog
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
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("inspection.cardTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm" data-testid="lease-inspections">
              {(
                [
                  ["check_in", checkIn],
                  ["check_out", checkOut],
                ] as const
              ).map(([kind, inspection]) => (
                <div key={kind} className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{t(`inspection.kind.${kind}`)}</div>
                    {inspection ? (
                      <InspectionPdf
                        fileId={inspection.pdfFileId}
                        inspectionId={inspection.id}
                        label={t("inspection.pdf", { date: formatDate(inspection.inspectedOn) })}
                      />
                    ) : (
                      <div className="text-muted-foreground">{t("inspection.none")}</div>
                    )}
                  </div>
                  {!inspection && canInspect && (kind === "check_out" || active) ? (
                    <InspectionDialog
                      leaseId={lease.id}
                      kind={kind}
                      leaseKind={lease.kind}
                      today={today}
                      entryElements={
                        kind === "check_out" ? (checkIn?.items.map((i) => i.element) ?? []) : []
                      }
                    />
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("tenant")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm" data-testid="lease-tenant">
              <div className="font-medium">{lease.tenantName}</div>
              {lease.tenantNameAr ? (
                <div dir="rtl" lang="ar">
                  {lease.tenantNameAr}
                </div>
              ) : null}
              {lease.activity ? (
                <div className="text-muted-foreground">{lease.activity}</div>
              ) : null}
              <div className="text-muted-foreground">
                <PhoneText value={lease.tenantPhone} />
              </div>
              {lease.tenantEmail ? (
                <div className="text-muted-foreground" dir="ltr">
                  {lease.tenantEmail}
                </div>
              ) : null}
              {lease.tenantIdNumber ? (
                <div className="text-muted-foreground" dir="ltr">
                  {lease.tenantIdNumber}
                </div>
              ) : null}
              {lease.tenantAddress ? (
                <div className="text-muted-foreground">{lease.tenantAddress}</div>
              ) : null}
              {lease.guarantorName ? (
                <div className="pt-2" data-testid="lease-guarantor">
                  <span className="text-muted-foreground">{t("guarantor")} : </span>
                  {lease.guarantorName}
                  {lease.guarantorIdNumber ? (
                    <span className="text-muted-foreground">
                      {" · "}
                      <bdi dir="ltr">{lease.guarantorIdNumber}</bdi>
                    </span>
                  ) : null}
                  {lease.guarantorPhone ? (
                    <span className="text-muted-foreground">
                      {" · "}
                      <bdi dir="ltr">{lease.guarantorPhone}</bdi>
                    </span>
                  ) : null}
                  {lease.guarantorAddress ? (
                    <div className="text-muted-foreground">{lease.guarantorAddress}</div>
                  ) : null}
                </div>
              ) : null}
              {lease.occupancy ? (
                <div className="pt-2">
                  <Link
                    href={`/residences/${lease.occupancy.residenceId}`}
                    className="text-sm hover:underline"
                  >
                    {t("occupant", { residence: lease.occupancy.residenceName })}
                  </Link>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("terms")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  <bdi dir="ltr">{lease.unitCode}</bdi> · {t(`kind.${lease.kind}`)}
                </span>
                {lease.status === "active" ? <UnitStatusBadge status="rented" /> : null}
              </div>
              <dl className="space-y-2" data-testid="lease-terms">
                {terms.map((row) => (
                  <div key={row.label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="text-end">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {lease.revisions.length > 0 ? (
                <ul className="space-y-1 border-t pt-2 text-xs" data-testid="lease-revisions">
                  {lease.revisions.map((r) => (
                    <li key={r.id}>
                      {t("revisions.line", {
                        date: formatDate(r.effectiveOn),
                        rent: money(r.monthlyRent),
                      })}
                      <span className="block text-muted-foreground">
                        {r.reason} · {r.createdByName}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Separator />
              <div className="space-y-1" data-testid="lease-deposit">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("fields.deposit")}</span>
                  <bdi dir="ltr">{money(lease.deposit)}</bdi>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("deposit.held")}</span>
                  <bdi dir="ltr">{money(lease.depositHeld)}</bdi>
                </div>
                {lease.depositCarried > 0n ? (
                  <p className="text-xs text-muted-foreground">
                    {t("deposit.carried", { amount: money(lease.depositCarried) })}
                  </p>
                ) : null}
                {lease.depositSettledOn ? (
                  <p className="text-muted-foreground">
                    {t("deposit.settledLine", {
                      date: formatDate(lease.depositSettledOn),
                      refunded: money(lease.depositRefunded ?? 0n),
                      retained: money(lease.depositRetained ?? 0n),
                    })}
                    {lease.depositRetentionReason ? ` · ${lease.depositRetentionReason}` : ""}
                  </p>
                ) : lease.renewal && lease.depositHeld > 0n ? (
                  <p className="text-xs text-muted-foreground">{t("deposit.movedToRenewal")}</p>
                ) : null}
                {settleable ? (
                  <SettleDepositDialog
                    leaseId={lease.id}
                    held={asInput(lease.depositHeld)}
                    today={today}
                    accounts={await listAccountChoices(ctx)}
                  />
                ) : null}
              </div>
              <Separator />
              <ContractScan
                leaseId={lease.id}
                fileId={lease.contractScanFileId}
                fileName={lease.scanFileName}
                editable={can(ctx.roles, "lease:update")}
              />
              {lease.notes ? (
                <p className="whitespace-pre-line text-muted-foreground">{lease.notes}</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
