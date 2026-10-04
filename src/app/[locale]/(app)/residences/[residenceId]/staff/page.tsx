import { CalendarCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { StaffDialog } from "@/components/staff/staff-dialogs";
import { Badge } from "@/components/ui/badge";
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
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getChargesSetup } from "@/server/charges/queries";
import { getResidence } from "@/server/residences/queries";
import { listStaff } from "@/server/staff/queries";

import { ResidenceNav } from "../_components/residence-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff");
  return { title: t("title") };
}

export default async function ResidenceStaffPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/staff">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("staff:read");
  const home = await getResidence(ctx, residenceId);
  if (!home) notFound();
  const staff = await listStaff(ctx, residenceId);
  const today = todayInAlgiers();
  const categories = can(ctx.roles, "charge:read")
    ? ((await getChargesSetup(ctx, residenceId, Number(today.slice(0, 4))))?.categories ?? [])
    : [];
  const t = await getTranslations("staff");
  const tr = await getTranslations("residences");
  const moneyLocale = (await getLocale()) === "ar" ? "ar" : "fr";
  const editable = can(ctx.roles, "staff:update");

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
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {staff.length > 0 ? (
              <Button asChild variant="outline">
                <Link href={`/residences/${residenceId}/staff/attendance`}>
                  <CalendarCheck data-icon="inline-start" />
                  {t("attendance.open")}
                </Link>
              </Button>
            ) : null}
            {editable ? (
              <StaffDialog residenceId={residenceId} categories={categories} today={today} />
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table data-testid="staff">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.name")}</TableHead>
                    <TableHead>{t("columns.role")}</TableHead>
                    <TableHead>{t("columns.phone")}</TableHead>
                    <TableHead>{t("columns.since")}</TableHead>
                    <TableHead className="text-end">{t("columns.salary")}</TableHead>
                    <TableHead>{t("columns.category")}</TableHead>
                    <TableHead>{t("columns.state")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link
                          href={`/residences/${residenceId}/staff/${s.id}`}
                          className="font-medium hover:underline"
                        >
                          {s.lastName} {s.firstName}
                        </Link>
                      </TableCell>
                      <TableCell>{t(`role.${s.role}`)}</TableCell>
                      <TableCell>{s.phone ? <PhoneText value={s.phone} /> : "—"}</TableCell>
                      <TableCell>{formatDate(s.hiredOn)}</TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {formatDZD(s.monthlySalary, moneyLocale)}
                      </TableCell>
                      <TableCell className="whitespace-normal">{s.categoryName ?? "—"}</TableCell>
                      <TableCell>
                        {s.employed ? (
                          <Badge variant="secondary">{t("employed")}</Badge>
                        ) : (
                          <Badge variant="outline">
                            {t("leftOn", { date: formatDate(s.leftOn ?? s.hiredOn) })}
                          </Badge>
                        )}
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
