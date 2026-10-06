import { FileSignature, Trash2, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { DeliveryStateBadge, PunchStatusBadge } from "@/components/handovers/badges";
import {
  CancelPunchItemDialog,
  CloseReservesDialog,
  LiftPunchItemDialog,
  PunchItemDialog,
  ScheduleHandoverDialog,
  SignHandoverDialog,
} from "@/components/handovers/handover-dialogs";
import { HandoverDocumentPdf } from "@/components/handovers/handover-document";
import {
  AssignClaimDialog,
  FixClaimDialog,
  RejectClaimDialog,
  ReportClaimDialog,
  WarrantyClaimBadge,
} from "@/components/handovers/warranty-dialogs";
import { PendingDocumentsRefresher } from "@/components/sales/document-pdf";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  addDays,
  formatDate,
  formatDateTime,
  toAlgiersDateTimeInput,
  todayInAlgiers,
} from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { runningWarranties, warrantyEnds } from "@/lib/obligations";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { deletePunchItemAction } from "@/server/handovers/actions";
import { getDelivery } from "@/server/handovers/queries";
import { listWarrantyClaims, listWarrantyContractors } from "@/server/handovers/warranty";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/deliveries/[saleId]">): Promise<Metadata> {
  const ctx = await requirePermission("handover:read");
  const delivery = await getDelivery(ctx, (await params).saleId);
  const t = await getTranslations("handovers.detail");
  return { title: delivery ? t("title", { unit: delivery.unitCode }) : undefined };
}

/** Handover workspace of a sold unit: appointment, reserves, PV de remise and PV de levée. */
export default async function DeliveryPage({ params }: PageProps<"/[locale]/deliveries/[saleId]">) {
  const { locale: raw, saleId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("handover:read");
  const delivery = await getDelivery(ctx, saleId);
  if (!delivery) notFound();
  const t = await getTranslations("handovers");
  const tc = await getTranslations("common");
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();
  const h = delivery.handover;
  const editable = can(ctx.roles, "handover:update");
  const signed = h?.status === "signed";
  const closed = h?.reservesClosedOn !== null && h?.reservesClosedOn !== undefined;
  const open = delivery.items.filter((i) => i.status === "open");
  const lifted = delivery.items.filter((i) => i.status === "lifted");
  /** Reserves printed on the signed PV keep their number and text. */
  const onPv = new Set(h?.reserves?.map((r) => r.position) ?? []);
  const mainBuyer = delivery.buyers[0];
  const pending =
    (signed && h?.pdfFileId === null) || (closed && h?.releaseFileId === null) || false;
  // After the PV: the warranties and the defects claimed under them.
  const deliveredOn = signed ? (h?.signedOn ?? null) : null;
  const claims = deliveredOn ? await listWarrantyClaims(ctx, delivery.id) : [];
  const contractors = deliveredOn && editable ? await listWarrantyContractors(ctx) : [];
  const tw = await getTranslations("warranty");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PendingDocumentsRefresher pending={pending} />
      <PageHeader
        title={t("detail.title", { unit: delivery.unitCode })}
        description={`${delivery.projectName} · ${delivery.buildingName}`}
        crumbs={[{ label: t("title"), href: "/deliveries" }]}
        badge={<DeliveryStateBadge state={delivery.state} />}
        actions={
          <>
            {can(ctx.roles, "sale:read") ? (
              <Button asChild variant="outline">
                <Link href={`/sales/${delivery.id}`}>
                  <FileSignature data-icon="inline-start" />
                  {t("detail.viewSale")}
                </Link>
              </Button>
            ) : null}
            {editable && !signed ? (
              <ScheduleHandoverDialog
                reservationId={delivery.id}
                scheduledAt={h?.scheduledAt ? toAlgiersDateTimeInput(h.scheduledAt) : null}
                notes={h?.notes ?? null}
                defaultAt={`${addDays(today, 1)}T10:00`}
              />
            ) : null}
            {editable && h && !signed ? (
              <SignHandoverDialog
                handoverId={h.id}
                receivedBy={mainBuyer ? `${mainBuyer.firstName} ${mainBuyer.lastName}` : ""}
                today={today}
                remaining={delivery.remaining > 0n ? money(delivery.remaining) : null}
                openReserves={open.length}
              />
            ) : null}
          </>
        }
      />

      {!delivery.ready && !signed ? (
        <Alert data-testid="delivery-not-ready">
          <TriangleAlert />
          <AlertDescription>{t("detail.notReady")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="text-base">{t("detail.reserves")}</CardTitle>
                {!signed ? (
                  <p className="text-sm text-muted-foreground">{t("detail.reservesHint")}</p>
                ) : null}
              </div>
              {editable && h && !closed ? <PunchItemDialog handoverId={h.id} /> : null}
            </CardHeader>
            <CardContent>
              {delivery.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("detail.noReserves")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table data-testid="punch-items">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("detail.columns.position")}</TableHead>
                        <TableHead>{t("detail.columns.location")}</TableHead>
                        <TableHead>{t("detail.columns.description")}</TableHead>
                        <TableHead>{t("detail.columns.trade")}</TableHead>
                        <TableHead>{t("detail.columns.dueOn")}</TableHead>
                        <TableHead>{t("detail.columns.status")}</TableHead>
                        {editable && !closed ? (
                          <TableHead>
                            <span className="sr-only">{tc("actions")}</span>
                          </TableHead>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {delivery.items.map((item) => {
                        const late =
                          item.status === "open" && item.dueOn !== null && item.dueOn < today;
                        const changeable =
                          item.status === "open" && !(signed && onPv.has(item.position));
                        return (
                          <TableRow key={item.id} data-position={item.position}>
                            <TableCell className="tabular-nums">{item.position}</TableCell>
                            <TableCell className="whitespace-normal">{item.location}</TableCell>
                            <TableCell className="whitespace-normal">{item.description}</TableCell>
                            <TableCell>{t(`trade.${item.trade}`)}</TableCell>
                            <TableCell>
                              {item.dueOn ? formatDate(item.dueOn) : "—"}
                              {late ? (
                                <span className="block text-xs text-red-800">
                                  {t("detail.late")}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="whitespace-normal">
                              <PunchStatusBadge status={item.status} />
                              {item.status === "lifted" && item.liftedOn ? (
                                <span className="block text-xs text-muted-foreground">
                                  {t("detail.liftedOn", { date: formatDate(item.liftedOn) })}
                                  {item.liftNote ? ` · ${item.liftNote}` : ""}
                                </span>
                              ) : null}
                              {item.status === "cancelled" ? (
                                <span className="block text-xs text-muted-foreground">
                                  {t("detail.cancelledFor", { reason: item.cancelReason ?? "—" })}
                                </span>
                              ) : null}
                            </TableCell>
                            {editable && !closed ? (
                              <TableCell>
                                {item.status === "open" ? (
                                  <div className="flex flex-wrap justify-end gap-1">
                                    <LiftPunchItemDialog
                                      punchItemId={item.id}
                                      position={item.position}
                                      today={today}
                                    />
                                    {changeable ? (
                                      <>
                                        <PunchItemDialog
                                          handoverId={item.handoverId}
                                          item={{
                                            id: item.id,
                                            location: item.location,
                                            description: item.description,
                                            trade: item.trade,
                                            dueOn: item.dueOn,
                                          }}
                                        />
                                        <ConfirmAction
                                          action={deletePunchItemAction}
                                          input={{ punchItemId: item.id }}
                                          label={t("reserve.deleteLabel", {
                                            position: item.position,
                                          })}
                                          icon={<Trash2 />}
                                          size="icon"
                                          variant="ghost"
                                          title={t("reserve.deleteTitle", {
                                            position: item.position,
                                          })}
                                          description={t("reserve.deleteDescription")}
                                          confirmLabel={tc("delete")}
                                          successMessage={t("reserve.deleted")}
                                          destructive
                                        />
                                      </>
                                    ) : (
                                      <CancelPunchItemDialog
                                        punchItemId={item.id}
                                        position={item.position}
                                      />
                                    )}
                                  </div>
                                ) : null}
                              </TableCell>
                            ) : null}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {deliveredOn && h ? (
            <Card data-testid="warranty-claims">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{tw("title")}</CardTitle>
                {editable && runningWarranties(deliveredOn, today).length > 0 ? (
                  <ReportClaimDialog handoverId={h.id} today={today} />
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {tw("ends", {
                    completion: formatDate(warrantyEnds(deliveredOn).completion),
                    functioning: formatDate(warrantyEnds(deliveredOn).functioning),
                    tenYear: formatDate(warrantyEnds(deliveredOn).tenYear),
                  })}
                </p>
                {claims.length === 0 ? (
                  <p className="text-muted-foreground">{tw("none")}</p>
                ) : (
                  <ul className="divide-y">
                    {claims.map((c) => {
                      const late = c.status === "assigned" && c.dueOn !== null && c.dueOn < today;
                      return (
                        <li
                          key={c.id}
                          className="flex flex-wrap items-start justify-between gap-2 py-2"
                          data-claim={c.position}
                        >
                          <span className="min-w-0 space-y-0.5">
                            <span className="font-medium">
                              {c.position}. {c.location}
                            </span>
                            <span className="block whitespace-pre-line">{c.description}</span>
                            <span className="block text-xs text-muted-foreground">
                              {tw(c.fromPortal ? "reportedPortal" : "reportedBy", {
                                date: formatDate(c.reportedOn),
                                name: c.reporterName,
                              })}
                            </span>
                            {c.supplierName && c.dueOn ? (
                              <span className="block text-xs">
                                {tw("assignedTo", {
                                  contractor: c.supplierName,
                                  kind: c.warrantyKind ? tw(`kind.${c.warrantyKind}`) : "—",
                                  date: formatDate(c.dueOn),
                                })}
                              </span>
                            ) : null}
                            {c.fixedOn ? (
                              <span className="block text-xs text-emerald-700">
                                {tw("fixedOn", { date: formatDate(c.fixedOn) })}
                              </span>
                            ) : null}
                            {c.note ? (
                              <span className="block text-xs text-muted-foreground">{c.note}</span>
                            ) : null}
                          </span>
                          <span className="flex flex-wrap items-center gap-2">
                            <WarrantyClaimBadge status={c.status} late={late} />
                            {editable && (c.status === "open" || c.status === "assigned") ? (
                              <>
                                {contractors.length > 0 ? (
                                  <AssignClaimDialog
                                    claimId={c.id}
                                    kinds={runningWarranties(deliveredOn, c.reportedOn)}
                                    contractors={contractors}
                                    dueOn={addDays(today, 15)}
                                    today={today}
                                  />
                                ) : null}
                                {c.status === "assigned" ? (
                                  <FixClaimDialog claimId={c.id} today={today} />
                                ) : null}
                                <RejectClaimDialog claimId={c.id} />
                              </>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("detail.documents")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm" data-testid="delivery-documents">
              {signed && h?.number && h.signedOn ? (
                <div className="space-y-1">
                  <div className="font-medium">{t("detail.pv", { number: h.number })}</div>
                  <div className="text-muted-foreground">
                    {t("detail.pvSigned", {
                      date: formatDate(h.signedOn),
                      name: h.receivedBy ?? "—",
                      keys: h.keysCount ?? 0,
                    })}
                  </div>
                  <div className="text-muted-foreground">
                    {t("detail.meters", {
                      electricity: h.electricityMeter ?? "—",
                      gas: h.gasMeter ?? "—",
                      water: h.waterMeter ?? "—",
                    })}
                  </div>
                  {h.outstanding !== null && h.outstanding > 0n ? (
                    <div className="text-amber-800">
                      {t("detail.outstandingOnPv", { amount: money(h.outstanding) })}
                    </div>
                  ) : null}
                  <HandoverDocumentPdf
                    fileId={h.pdfFileId}
                    kind="handover_pv"
                    handoverId={h.id}
                    label={t("detail.pdf")}
                  />
                </div>
              ) : (
                <p className="text-muted-foreground">{t("detail.noPv")}</p>
              )}
              {closed && h?.reservesClosedOn ? (
                <div className="space-y-1">
                  <div className="font-medium">
                    {t("detail.release", { date: formatDate(h.reservesClosedOn) })}
                  </div>
                  <HandoverDocumentPdf
                    fileId={h.releaseFileId}
                    kind="handover_release"
                    handoverId={h.id}
                    label={t("detail.releasePdf")}
                  />
                </div>
              ) : signed && lifted.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground">{t("detail.releaseHint")}</p>
                  {editable && open.length === 0 && h ? (
                    <CloseReservesDialog handoverId={h.id} today={today} />
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("detail.appointment")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm" data-testid="delivery-appointment">
              {h?.scheduledAt ? (
                <div className="font-medium">
                  {t("detail.appointmentAt", { date: formatDateTime(h.scheduledAt) })}
                </div>
              ) : (
                <p className="text-muted-foreground">{t("detail.noAppointment")}</p>
              )}
              {h?.notes ? (
                <p className="whitespace-pre-line text-muted-foreground">{h.notes}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("detail.sale")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm" data-testid="delivery-sale">
              {delivery.buyers.map((b) => (
                <div key={b.id}>
                  <div className="font-medium">
                    {b.lastName} {b.firstName}
                  </div>
                  <div className="text-muted-foreground">
                    <PhoneText value={b.phone} />
                  </div>
                </div>
              ))}
              {delivery.saleNumber && delivery.saleSignedOn ? (
                <p className="text-muted-foreground">
                  {t("detail.vsp", {
                    number: delivery.saleNumber,
                    date: formatDate(delivery.saleSignedOn),
                  })}
                </p>
              ) : null}
              <dl className="space-y-1">
                {(
                  [
                    ["price", delivery.price],
                    ["paid", delivery.paid],
                    ["remaining", delivery.remaining],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t(`detail.${key}`)}</dt>
                    <dd
                      className={
                        key === "remaining" && value > 0n
                          ? "font-semibold text-amber-800 tabular-nums"
                          : "tabular-nums"
                      }
                    >
                      <bdi dir="ltr">{money(value)}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
              {delivery.remaining === 0n ? (
                <p className="text-emerald-800">{t("detail.settled")}</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
