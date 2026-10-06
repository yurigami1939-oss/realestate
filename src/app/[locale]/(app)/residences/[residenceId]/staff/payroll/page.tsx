import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PayrollTable } from "@/components/staff/payroll-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { addMonths, todayInAlgiers } from "@/lib/dates";
import { formatDZD, sumCentimes } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getResidence } from "@/server/residences/queries";
import { getPayrollMonth } from "@/server/staff/pay";
import { listAccountChoices } from "@/server/treasury/queries";

import { ResidenceNav } from "../../_components/residence-nav";

/** `?month=2026-10` → "2026-10-01"; anything else → the current Algiers month. */
function parseMonth(raw: string | string[] | undefined): string {
  return typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)
    ? `${raw}-01`
    : `${todayInAlgiers().slice(0, 7)}-01`;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff.payroll");
  return { title: t("open") };
}

export default async function PayrollPage({
  params,
  searchParams,
}: PageProps<"/[locale]/residences/[residenceId]/staff/payroll">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("staff:read");
  const month = parseMonth((await searchParams).month);
  const home = await getResidence(ctx, residenceId);
  const sheet = await getPayrollMonth(ctx, residenceId, month);
  if (!home || !sheet) notFound();
  const t = await getTranslations("staff.payroll");
  const tp = await getTranslations("charges.period");
  const tr = await getTranslations("residences");
  const moneyLocale = (await getLocale()) === "ar" ? "ar" : "fr";
  const label = (m: string) =>
    tp("monthly", { year: Number(m.slice(0, 4)), index: Number(m.slice(5, 7)) });
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  const href = (m: string) => `/residences/${residenceId}/staff/payroll?month=${m.slice(0, 7)}`;
  const recorded = sheet.rows.flatMap((r) => (r.pay ? [r.pay] : []));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={home.name}
        description={home.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
      />
      <ResidenceNav residenceId={residenceId} current="staff" roles={ctx.roles} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("title", { month: label(month) })}</CardTitle>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={href(previous)}>
                <ChevronLeft data-icon="inline-start" className="rtl:rotate-180" />
                {label(previous)}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={href(next)}>
                {label(next)}
                <ChevronRight data-icon="inline-end" className="rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <PayrollTable
            rows={sheet.rows}
            month={month}
            editable={can(ctx.roles, "staff:update")}
            today={todayInAlgiers()}
            accounts={can(ctx.roles, "staff:update") ? await listAccountChoices(ctx) : []}
          />
          {recorded.length > 0 ? (
            <p className="text-sm">
              {t("totals", {
                count: recorded.length,
                net: formatDZD(sumCentimes(recorded.map((p) => p.netAmount)), moneyLocale),
              })}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
