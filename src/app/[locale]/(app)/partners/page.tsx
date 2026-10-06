import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PartnerDialog, PayPartnerCommissionDialog } from "@/components/partners/partner-dialogs";
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
import { formatDZD, formatPercentInput } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { requireTenantCtx } from "@/server/auth/page-guard";
import { listPartnerCommissions, listPartners } from "@/server/partners/service";
import { listAccountChoices } from "@/server/treasury/queries";
import { notFound } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partners");
  return { title: t("title") };
}

/** Agencies and introducers with their leads and commissions (CLAUDE.md §7 CRM). */
export default async function PartnersPage({ params }: PageProps<"/[locale]/partners">) {
  const { locale: raw } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requireTenantCtx();
  const manages = can(ctx.roles, "lead:assign");
  const readsCommissions = can(ctx.roles, "commission:read_all");
  if (!manages && !readsCommissions) notFound();
  const partners = await listPartners(ctx);
  const commissions = readsCommissions ? await listPartnerCommissions(ctx) : [];
  const canPay = can(ctx.roles, "commission:update");
  const accounts = canPay ? await listAccountChoices(ctx) : [];
  const t = await getTranslations("partners");
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={manages ? <PartnerDialog /> : null}
      />
      {partners.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("none")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="partners">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.contact")}</TableHead>
                <TableHead className="text-end">{t("columns.rate")}</TableHead>
                <TableHead className="text-end">{t("columns.leads")}</TableHead>
                <TableHead className="text-end">{t("columns.earned")}</TableHead>
                <TableHead className="text-end">{t("columns.paid")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((p) => (
                <TableRow key={p.id} data-partner={p.name}>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`kind.${p.kind}`)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {[p.contactName, p.phone, p.email].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatShare(p.commissionRateBp)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{p.leads}</TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(p.earned)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(p.paid)}
                  </TableCell>
                  <TableCell className="text-end">
                    {manages ? (
                      <PartnerDialog
                        partnerId={p.id}
                        values={{
                          kind: p.kind,
                          name: p.name,
                          contactName: p.contactName ?? "",
                          phone: p.phone ?? "",
                          email: p.email ?? "",
                          nif: p.nif ?? "",
                          rcNumber: p.rcNumber ?? "",
                          commissionRate: formatPercentInput(p.commissionRateBp),
                          notes: p.notes ?? "",
                        }}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {readsCommissions ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("commissions")}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {commissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noCommissions")}</p>
            ) : (
              <Table data-testid="partner-commissions">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.name")}</TableHead>
                    <TableHead>{t("columns.sale")}</TableHead>
                    <TableHead className="text-end">{t("columns.amount")}</TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissions.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.partnerName}</TableCell>
                      <TableCell>
                        <Link href={`/sales/${c.reservationId}`} className="hover:underline">
                          {c.saleNumber}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          <bdi dir="ltr">{c.unitCode}</bdi> · {formatDate(c.earnedOn)}
                        </span>
                      </TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {money(c.amount)}
                        <span className="block text-xs text-muted-foreground">
                          {formatShare(c.rateBp)} · {money(c.base)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.status === "earned" ? "default" : "secondary"}>
                          {t(`status.${c.status}`)}
                        </Badge>
                        {c.paidOn ? (
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(c.paidOn)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-end">
                        {canPay && c.status === "earned" ? (
                          <PayPartnerCommissionDialog
                            commissionId={c.id}
                            today={today}
                            accounts={accounts}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
