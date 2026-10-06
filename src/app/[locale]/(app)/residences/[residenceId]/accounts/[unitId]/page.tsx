import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ChargeDocumentPdf } from "@/components/residences/charge-document-pdf";
import { ChargeReminderDialog } from "@/components/residences/charge-reminder-dialog";
import { InstallmentStateBadge } from "@/components/sales/badges";
import { PendingDocumentsRefresher } from "@/components/sales/document-pdf";
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
import { toLocale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/page-guard";
import { getUnitAccount, listUnitReminders } from "@/server/charges/queries";
import { listAccountChoices } from "@/server/treasury/queries";

import {
  CancelChargePaymentDialog,
  ClearChargeChequeDialog,
  RecordChargePaymentDialog,
} from "./_components/payment-dialogs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("charges.accounts");
  return { title: t("title") };
}

export default async function UnitAccountPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/accounts/[unitId]">) {
  const { locale, residenceId, unitId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("charge:read");
  const account = await getUnitAccount(ctx, residenceId, unitId);
  if (!account) notFound();
  const reminders = await listUnitReminders(ctx, residenceId, unitId);
  const accounts = can(ctx.roles, "payment:create") ? await listAccountChoices(ctx) : [];
  const t = await getTranslations("charges.accounts");
  const tp = await getTranslations("charges.period");
  const tpay = await getTranslations("payments");
  const tr = await getTranslations("residences");
  const trem = await getTranslations("charges.reminders");
  const moneyLocale = (await getLocale()) === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, moneyLocale);
  const today = todayInAlgiers();
  const { statement } = account;
  const tiles = [
    { key: "called", value: statement.price },
    { key: "paid", value: statement.paid + statement.credit },
    { key: "remaining", value: statement.remaining },
    { key: "overdue", value: statement.overdue },
    { key: "credit", value: statement.credit },
  ] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("unitTitle", { code: account.code })}
        description={[
          account.buildingName,
          account.typology,
          t("shares", { share: account.share, basis: account.shareBasis }),
          account.coOwner ?? t("noCoOwner"),
        ]
          .filter(Boolean)
          .join(" · ")}
        crumbs={[
          { label: tr("title"), href: "/residences" },
          { label: account.residenceName, href: `/residences/${residenceId}` },
          { label: t("title"), href: `/residences/${residenceId}/accounts` },
        ]}
        actions={
          <>
            {statement.overdue > 0n && can(ctx.roles, "charge:remind") ? (
              <ChargeReminderDialog
                residenceId={residenceId}
                unitId={unitId}
                code={account.code}
                overdue={statement.overdue}
                today={today}
              />
            ) : null}
            {can(ctx.roles, "payment:create") ? (
              <RecordChargePaymentDialog
                residenceId={residenceId}
                unitId={unitId}
                code={account.code}
                remaining={statement.remaining}
                payerName={account.coOwner ?? ""}
                today={today}
                accounts={accounts}
              />
            ) : null}
          </>
        }
      />
      <dl className="grid gap-2 text-sm sm:grid-cols-5" data-testid="account-totals">
        {tiles.map((tile) => (
          <div key={tile.key} className="rounded-md border p-2">
            <dt className="text-muted-foreground">{t(`totals.${tile.key}`)}</dt>
            <dd
              className={cn(
                "font-medium tabular-nums",
                tile.key === "overdue" && tile.value > 0n && "text-red-700",
              )}
            >
              <bdi dir="ltr">{money(tile.value)}</bdi>
            </dd>
          </div>
        ))}
      </dl>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("callsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {statement.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noCalls")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table data-testid="account-calls">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.call")}</TableHead>
                    <TableHead>{t("columns.period")}</TableHead>
                    <TableHead>{t("columns.dueOn")}</TableHead>
                    <TableHead className="text-end">{t("columns.amount")}</TableHead>
                    <TableHead className="text-end">{t("columns.paid")}</TableHead>
                    <TableHead className="text-end">{t("columns.remaining")}</TableHead>
                    <TableHead>{t("columns.state")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <ChargeDocumentPdf
                          fileId={l.pdfFileId}
                          kind="charge_call"
                          id={l.id}
                          label={l.number}
                        />
                      </TableCell>
                      <TableCell>
                        {tp(l.frequency, { year: l.year, index: l.periodIndex })}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {l.dueOn ? formatDate(l.dueOn) : "—"}
                      </TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {money(l.amount)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {money(l.paid)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {money(l.remaining)}
                      </TableCell>
                      <TableCell>
                        <InstallmentStateBadge state={l.state} label={t(`state.${l.state}`)} />
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
          <CardTitle className="text-base">{t("paymentsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {account.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tpay("none")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table data-testid="account-payments">
                <TableHeader>
                  <TableRow>
                    <TableHead>{tpay("columns.date")}</TableHead>
                    <TableHead>{tpay("columns.receipt")}</TableHead>
                    <TableHead className="text-end">{tpay("columns.amount")}</TableHead>
                    <TableHead>{tpay("columns.method")}</TableHead>
                    <TableHead>{tpay("fields.payerName")}</TableHead>
                    <TableHead>{tpay("columns.status")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("columns.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {account.payments.map((p) => {
                    const valid = p.status === "valid";
                    const pendingCheque = valid && p.method === "cheque" && !p.chequeClearedOn;
                    return (
                      <TableRow key={p.id} className={cn(!valid && "text-muted-foreground")}>
                        <TableCell dir="ltr" className="text-start">
                          {formatDate(p.paidOn)}
                        </TableCell>
                        <TableCell>
                          {valid ? (
                            <ChargeDocumentPdf
                              fileId={p.pdfFileId}
                              kind="charge_receipt"
                              id={p.id}
                              label={p.receiptNumber}
                            />
                          ) : (
                            <span dir="ltr" className="line-through">
                              {p.receiptNumber}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-end tabular-nums" dir="ltr">
                          {money(p.amount)}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {tpay(`method.${p.method}`)}
                          {p.reference ? (
                            <span className="text-muted-foreground" dir="ltr">
                              {" "}
                              {p.reference}
                            </span>
                          ) : null}
                          {p.bank ? (
                            <span className="text-muted-foreground"> · {p.bank}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-normal">{p.payerName}</TableCell>
                        <TableCell className="whitespace-normal">
                          {!valid ? (
                            <Badge variant="outline">
                              {tpay("cancelledBy", { reason: p.cancellationReason ?? "" })}
                            </Badge>
                          ) : pendingCheque ? (
                            <Badge variant="outline" className="text-amber-800">
                              {tpay("pendingCheque")}
                            </Badge>
                          ) : p.chequeClearedOn ? (
                            tpay("chequeCleared", { date: formatDate(p.chequeClearedOn) })
                          ) : null}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-1">
                            {pendingCheque && can(ctx.roles, "payment:create") ? (
                              <ClearChargeChequeDialog paymentId={p.id} today={today} />
                            ) : null}
                            {valid && can(ctx.roles, "payment:cancel") ? (
                              <CancelChargePaymentDialog
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
      {reminders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{trem("title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="account-reminders">
              {reminders.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {trem("line", {
                      date: formatDate(r.issuedAt),
                      amount: money(r.overdue),
                      name: r.issuedByName,
                    })}
                  </span>
                  <ChargeDocumentPdf
                    fileId={r.pdfFileId}
                    kind="charge_reminder"
                    id={r.id}
                    label={trem("pdf", { date: formatDate(r.issuedAt) })}
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <PendingDocumentsRefresher
        pending={
          account.payments.some((p) => p.status === "valid" && p.pdfFileId === null) ||
          statement.lines.some((l) => l.pdfFileId === null) ||
          reminders.some((r) => r.pdfFileId === null)
        }
      />
    </div>
  );
}
