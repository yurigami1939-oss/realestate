import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import {
  CancelStatementDialog,
  EndMandateDialog,
  IssueStatementDialog,
  MandateDialog,
  OwnerDialog,
  OwnerStatementPdf,
  PayStatementDialog,
} from "@/components/mandates/mandate-dialogs";
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
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getOwner, listMandatableUnits } from "@/server/mandates/queries";
import { listAccountChoices } from "@/server/treasury/queries";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/rentals/owners/[ownerId]">): Promise<Metadata> {
  const ctx = await requirePermission("lease:read");
  const owner = await getOwner(ctx, (await params).ownerId);
  return { title: owner?.name };
}

/**
 * An owner under management mandate: its identity and bank details, the units it entrusted
 * (with their lease), its statements (relevés de gérance) and what the next one would report.
 */
export default async function OwnerPage({
  params,
}: PageProps<"/[locale]/rentals/owners/[ownerId]">) {
  const { locale: raw, ownerId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("lease:read");
  const owner = await getOwner(ctx, ownerId);
  if (!owner) notFound();
  const editable = can(ctx, "lease:update");
  const units = editable ? await listMandatableUnits(ctx) : [];
  const accounts = editable ? await listAccountChoices(ctx) : [];
  const t = await getTranslations("mandates");
  const tr = await getTranslations("rentals");
  const tp = await getTranslations("payments");
  const today = todayInAlgiers();
  const money = (v: bigint) => formatDZD(v, locale);
  const text = (v: string | null) => v ?? "";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={owner.name}
        crumbs={[
          { label: tr("title"), href: "/rentals" },
          { label: t("title"), href: "/rentals/owners" },
        ]}
        actions={
          editable ? (
            <OwnerDialog
              ownerId={owner.id}
              current={{
                name: owner.name,
                nameAr: text(owner.nameAr),
                idNumber: text(owner.idNumber),
                phone: owner.phone,
                email: text(owner.email),
                address: text(owner.address),
                bank: text(owner.bank),
                rib: text(owner.rib),
                notes: text(owner.notes),
              }}
            />
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t("owner.card")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm" data-testid="owner-identity">
            {owner.nameAr ? <div lang="ar">{owner.nameAr}</div> : null}
            <div>
              <PhoneText value={owner.phone} />
            </div>
            {owner.email ? <div dir="ltr">{owner.email}</div> : null}
            {owner.address ? <div>{owner.address}</div> : null}
            {owner.idNumber ? (
              <div className="text-muted-foreground">
                {t("owner.fields.idNumber")} : <bdi dir="ltr">{owner.idNumber}</bdi>
              </div>
            ) : null}
            {owner.rib ? (
              <div className="text-muted-foreground">
                {owner.bank ? `${owner.bank} · ` : ""}
                <bdi dir="ltr">{owner.rib}</bdi>
              </div>
            ) : null}
            {owner.notes ? (
              <p className="whitespace-pre-line text-muted-foreground">{owner.notes}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("mandate.title")}</CardTitle>
            {editable ? <MandateDialog ownerId={owner.id} units={units} today={today} /> : null}
          </CardHeader>
          <CardContent>
            {owner.mandates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("mandate.empty")}</p>
            ) : (
              <ul className="divide-y text-sm" data-testid="owner-mandates">
                {owner.mandates.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                    data-unit={m.unitCode}
                  >
                    <div>
                      <span className="font-medium">
                        <bdi dir="ltr">{m.unitCode}</bdi> · {m.projectName}
                      </span>{" "}
                      <Badge variant={m.status === "active" ? "secondary" : "outline"}>
                        {t(`mandate.status.${m.status}`)}
                      </Badge>
                      <div className="text-xs text-muted-foreground">
                        {t("mandate.line", {
                          from: formatDate(m.startOn),
                          rate: m.feeRateBp / 100,
                        })}
                        {m.endedOn
                          ? ` · ${t("mandate.endedLine", { date: formatDate(m.endedOn) })}`
                          : ""}
                      </div>
                      {m.lease ? (
                        <Link href={`/rentals/${m.lease.id}`} className="text-xs hover:underline">
                          <bdi dir="ltr">{m.lease.number}</bdi> · {m.lease.tenantName}
                        </Link>
                      ) : m.status === "active" ? (
                        <div className="text-xs text-muted-foreground">{t("mandate.vacant")}</div>
                      ) : null}
                    </div>
                    {editable && m.status === "active" && !m.lease ? (
                      <EndMandateDialog mandateId={m.id} today={today} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle>{t("statement.title")}</CardTitle>
            <p className="text-sm text-muted-foreground" data-testid="owner-pending">
              {owner.pending.lines.length === 0
                ? t("statement.nothingPending")
                : t("statement.pending", {
                    count: owner.pending.lines.length,
                    amount: money(owner.pending.collected),
                  })}
            </p>
          </div>
          {editable ? (
            <IssueStatementDialog
              ownerId={owner.id}
              today={today}
              pending={{
                lines: owner.pending.lines.length,
                collected: owner.pending.collected,
                fees: owner.pending.fees,
              }}
            />
          ) : null}
        </CardHeader>
        <CardContent>
          {owner.statements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("statement.empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table data-testid="owner-statements">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("statement.columns.number")}</TableHead>
                    <TableHead>{t("statement.columns.period")}</TableHead>
                    <TableHead className="text-end">{t("statement.columns.collected")}</TableHead>
                    <TableHead className="text-end">{t("statement.columns.fees")}</TableHead>
                    <TableHead className="text-end">{t("statement.columns.net")}</TableHead>
                    <TableHead>{t("statement.columns.status")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {owner.statements.map((s) => (
                    <TableRow key={s.id} data-statement={s.number}>
                      <TableCell>
                        <bdi dir="ltr" className="font-medium">
                          {s.number}
                        </bdi>
                        <div>
                          <OwnerStatementPdf
                            fileId={s.pdfFileId}
                            statementId={s.id}
                            label={t("statement.pdf")}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {s.periodFrom ? `${formatDate(s.periodFrom)} → ` : "→ "}
                        {formatDate(s.periodTo)}
                      </TableCell>
                      <TableCell className="text-end">
                        <bdi dir="ltr" className="tabular-nums">
                          {money(s.collected)}
                        </bdi>
                      </TableCell>
                      <TableCell className="text-end">
                        <bdi dir="ltr" className="tabular-nums">
                          {money(s.fees + s.deductions)}
                        </bdi>
                      </TableCell>
                      <TableCell className="text-end">
                        <bdi dir="ltr" className="font-medium tabular-nums">
                          {money(s.net)}
                        </bdi>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <Badge variant={s.status === "issued" ? "outline" : "secondary"}>
                          {t(`statement.status.${s.status}`)}
                        </Badge>
                        {s.paidOn && s.paymentMethod ? (
                          <div className="text-xs text-muted-foreground">
                            {formatDate(s.paidOn)} · {tp(`method.${s.paymentMethod}`)}
                          </div>
                        ) : null}
                        {s.cancellationReason ? (
                          <div className="text-xs text-muted-foreground">
                            {s.cancellationReason}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {editable && s.status === "issued" ? (
                          <div className="flex flex-wrap justify-end gap-1">
                            <PayStatementDialog
                              statementId={s.id}
                              today={today}
                              accounts={accounts}
                            />
                            <CancelStatementDialog statementId={s.id} />
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
