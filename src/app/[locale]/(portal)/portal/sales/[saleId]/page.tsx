import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BuildingProgressBar } from "@/components/construction/building-progress";
import { PayOnlineDialog } from "@/components/online-payments/pay-online-dialog";
import { ReportCard } from "@/components/construction/report-card";
import { PortalStatementButton } from "@/components/certificates/portal-statement-button";
import { PortalDocument } from "@/components/portal/portal-document";
import { PendingDocumentsRefresher } from "@/components/sales/document-pdf";
import { InstallmentStateBadge, SaleStatusBadge } from "@/components/sales/badges";
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
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatAmountInput, formatDZD } from "@/lib/money";
import { warrantyEnds } from "@/lib/obligations";
import { onlinePaymentOffer } from "@/lib/online-payments";
import { cn } from "@/lib/utils";
import { getPortalPaymentOptions } from "@/server/online-payments/queries";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { getPortalSale } from "@/server/portal/sales";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.sale");
  return { title: t("title") };
}

/** A purchase as its buyer sees it (CLAUDE.md §12): schedule, payments, documents, progress. */
export default async function PortalSalePage({
  params,
}: PageProps<"/[locale]/portal/sales/[saleId]">) {
  const { locale: raw, saleId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePortalCtx();
  const sale = await getPortalSale(ctx, saleId);
  if (!sale) notFound();
  const t = await getTranslations("portal.sale");
  const ts = await getTranslations("sales.statement");
  const tm = await getTranslations("payments.method");
  const tl = await getTranslations("sales.loan");
  const tp = await getTranslations("portal.pay");
  const tc = await getTranslations("certificates");
  const options = await getPortalPaymentOptions(ctx);
  const offer = options?.sale ? onlinePaymentOffer(sale.statement) : null;
  const money = (v: bigint) => formatDZD(v, locale);
  const { statement } = sale;
  const area = sale.livingArea ?? sale.usableArea;
  const hasDocuments =
    sale.sheetFileId || sale.contractFileId || sale.deedFileId || sale.calls.length > 0;

  return (
    <div className="space-y-6">
      <Link
        href="/portal"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("back")}
      </Link>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">
            {sale.projectName} · <bdi dir="ltr">{sale.unitCode}</bdi>
          </h1>
          <SaleStatusBadge status={sale.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            sale.buildingName,
            sale.unitTypology,
            area ? `${area.replace(".", ",")} m²` : null,
            t("reserved", { number: sale.number, date: formatDate(sale.reservedOn) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {sale.saleNumber && sale.saleSignedOn ? (
          <p className="text-sm text-muted-foreground" data-testid="portal-vsp">
            {t("vsp", { number: sale.saleNumber, date: formatDate(sale.saleSignedOn) })}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {t("buyers", {
            names: sale.buyers.map((b) => `${b.lastName} ${b.firstName}`).join(", "),
          })}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="portal-figures">
        {(
          [
            ["price", statement.price],
            ["paid", statement.paid],
            ["remaining", statement.remaining],
            ["overdue", statement.overdue],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-md border bg-background p-3">
            <dt className="text-muted-foreground">{ts(key)}</dt>
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

      {offer && options ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"
          data-testid="portal-pay-online"
        >
          <p className="text-sm text-muted-foreground">{tp("intro")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/portal/payments"
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              {tp("history")}
            </Link>
            <PayOnlineDialog
              purpose="sale"
              targetId={sale.id}
              suggested={formatAmountInput(offer.suggested)}
              remaining={money(offer.remaining)}
              test={options.environment === "test"}
            />
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("schedule")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table data-testid="portal-schedule">
              <TableHeader>
                <TableRow>
                  <TableHead>{ts("columns.step")}</TableHead>
                  <TableHead>{ts("columns.due")}</TableHead>
                  <TableHead className="text-end">{ts("columns.amount")}</TableHead>
                  <TableHead className="text-end">{ts("columns.remaining")}</TableHead>
                  <TableHead>{ts("columns.state")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.lines.map((line) => (
                  <TableRow key={line.position}>
                    <TableCell className="whitespace-normal">{line.label}</TableCell>
                    <TableCell className="whitespace-normal">
                      {line.dueOn
                        ? formatDate(line.dueOn)
                        : t("atMilestone", { milestone: line.milestoneName ?? "—" })}
                    </TableCell>
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
          <CardTitle className="text-base">{t("payments")}</CardTitle>
        </CardHeader>
        <CardContent>
          {sale.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="portal-payments">
              {sale.payments.map((p) => (
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
                        {t("cancelled")}
                      </Badge>
                    ) : p.method === "cheque" && !p.chequeClearedOn ? (
                      <Badge variant="outline" className="ms-2">
                        {t("chequePending")}
                      </Badge>
                    ) : null}
                  </div>
                  {p.receiptNumber !== null ? (
                    <PortalDocument
                      fileId={p.receiptPdfFileId}
                      label={t("receipt", { number: p.receiptNumber })}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("importedReceipt", { number: p.legacyReceipt ?? "—" })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("documents")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2" data-testid="portal-documents">
          {!hasDocuments && sale.reminders.length === 0 && sale.amendments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
          ) : null}
          {sale.sheetFileId ? (
            <div>
              <PortalDocument fileId={sale.sheetFileId} label={t("sheet")} />
            </div>
          ) : null}
          {sale.contractFileId ? (
            <div>
              <PortalDocument fileId={sale.contractFileId} label={t("contract")} />
            </div>
          ) : null}
          {sale.deedFileId ? (
            <div>
              <PortalDocument fileId={sale.deedFileId} label={t("deed")} />
            </div>
          ) : null}
          {sale.amendments.map((a) => (
            <div key={a.id}>
              <PortalDocument
                fileId={a.pdfFileId}
                label={t("amendment", { number: a.sequence, date: formatDate(a.signedOn) })}
              />
            </div>
          ))}
          {sale.calls.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2">
              <PortalDocument
                fileId={c.pdfFileId}
                label={t("call", { number: c.number, label: c.label })}
              />
              <span className="text-sm text-muted-foreground">
                <bdi dir="ltr">{money(c.called)}</bdi> · {t("payBy", { date: formatDate(c.dueOn) })}
              </span>
            </div>
          ))}
          {sale.reminders.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2">
              <PortalDocument
                fileId={r.pdfFileId}
                label={t("reminder", { date: formatDate(r.issuedAt) })}
              />
              <span className="text-sm text-muted-foreground">
                {t("payBy", { date: formatDate(r.payBy) })}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("certificates")}</CardTitle>
          <PortalStatementButton reservationId={sale.id} />
        </CardHeader>
        <CardContent className="space-y-2" data-testid="portal-certificates">
          {sale.certificates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noCertificates")}</p>
          ) : (
            sale.certificates.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <PortalDocument
                  fileId={c.pdfFileId}
                  label={`${tc(`kind.${c.kind}`)} · ${c.number}`}
                />
                <span className="text-sm text-muted-foreground" dir="ltr">
                  {formatDate(c.issuedAt)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <PendingDocumentsRefresher pending={sale.certificates.some((c) => c.pdfFileId === null)} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("progress")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <BuildingProgressBar name={sale.buildingName} progress={sale.progress} />
          {sale.deliveryDueOn ? (
            <p className="text-sm" data-testid="portal-delivery-due">
              {t("deliveryDueOn", { date: formatDate(sale.deliveryDueOn) })}
            </p>
          ) : null}
          {sale.milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMilestones")}</p>
          ) : (
            <ol className="space-y-2 text-sm" data-testid="portal-progress">
              {sale.milestones.map((m) => (
                <li key={m.id} className="flex items-start gap-2">
                  {m.validatedOn ? (
                    <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                  )}
                  <div>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-muted-foreground">
                      {m.validatedOn
                        ? t("done", { date: formatDate(m.validatedOn) })
                        : m.plannedOn
                          ? t("planned", { date: formatDate(m.plannedOn) })
                          : t("notPlanned")}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {sale.handover ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("handover")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm" data-testid="portal-handover">
            {sale.handover.status === "signed" && sale.handover.signedOn ? (
              <>
                <p className="font-medium">
                  {t("handoverSigned", { date: formatDate(sale.handover.signedOn) })}
                </p>
                <div>
                  <PortalDocument fileId={sale.handover.pdfFileId} label={t("handoverPv")} />
                </div>
                <p className="text-muted-foreground">
                  {t("warranties", {
                    completion: formatDate(warrantyEnds(sale.handover.signedOn).completion),
                    tenYear: formatDate(warrantyEnds(sale.handover.signedOn).tenYear),
                  })}
                </p>
              </>
            ) : sale.handover.scheduledAt ? (
              <p className="font-medium">
                {t("handoverAt", { date: formatDateTime(sale.handover.scheduledAt) })}
              </p>
            ) : null}
            {sale.handover.reserves.length > 0 ? (
              <div className="space-y-1">
                <div className="font-medium">{t("handoverReserves")}</div>
                <ol className="space-y-1">
                  {sale.handover.reserves.map((r) => (
                    <li key={r.position} className="flex flex-wrap gap-x-2">
                      <span className="tabular-nums">{r.position}.</span>
                      <span>
                        {r.location} · {r.description}
                      </span>
                      <span className="text-muted-foreground">
                        {r.status === "lifted" && r.liftedOn
                          ? t("handoverReserveLifted", { date: formatDate(r.liftedOn) })
                          : r.status === "cancelled"
                            ? t("handoverReserveCancelled")
                            : t("handoverReserveOpen")}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : sale.handover.status === "signed" ? (
              <p className="text-muted-foreground">{t("handoverNoReserve")}</p>
            ) : null}
            {sale.handover.reservesClosedOn ? (
              <div>
                <PortalDocument fileId={sale.handover.releaseFileId} label={t("handoverRelease")} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {sale.reports.length > 0 ? (
        <section className="space-y-3" data-testid="portal-reports">
          <h2 className="text-lg font-semibold">{t("reports")}</h2>
          {sale.reports.map((report) => (
            <ReportCard key={report.id} report={report} variant="portal" locale={locale} />
          ))}
        </section>
      ) : null}

      {sale.loans.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tl("title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm" data-testid="portal-loans">
              {sale.loans.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.bank}</span>
                  <Badge variant="outline">{tl(`statuses.${l.status}`)}</Badge>
                  <span className="text-muted-foreground">
                    {t("loanAmount", {
                      amount: money(l.approved ?? l.requested),
                    })}
                    {l.decidedOn
                      ? ` · ${t("loanDecided", { date: formatDate(l.decidedOn) })}`
                      : l.submittedOn
                        ? ` · ${t("loanSubmitted", { date: formatDate(l.submittedOn) })}`
                        : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
