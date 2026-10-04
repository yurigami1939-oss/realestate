import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneText } from "@/components/crm/phone";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { AdvanceDialog, EndStaffDialog, StaffDialog } from "@/components/staff/staff-dialogs";
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
import { requirePermission } from "@/server/auth/page-guard";
import { getChargesSetup } from "@/server/charges/queries";
import { getResidence } from "@/server/residences/queries";
import { deleteAdvanceAction } from "@/server/staff/actions";
import { getStaffMember } from "@/server/staff/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staff");
  return { title: t("title") };
}

export default async function StaffMemberPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/staff/[staffId]">) {
  const { locale, residenceId, staffId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("staff:read");
  const agent = await getStaffMember(ctx, residenceId, staffId);
  const home = await getResidence(ctx, residenceId);
  if (!agent || !home) notFound();
  const today = todayInAlgiers();
  const categories = can(ctx.roles, "charge:read")
    ? ((await getChargesSetup(ctx, residenceId, Number(today.slice(0, 4))))?.categories ?? [])
    : [];
  const t = await getTranslations("staff");
  const tr = await getTranslations("residences");
  const moneyLocale = (await getLocale()) === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, moneyLocale);
  const editable = can(ctx.roles, "staff:update");
  const arabicName = [agent.lastNameAr, agent.firstNameAr].filter(Boolean).join(" ");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={`${agent.lastName} ${agent.firstName}`}
        description={[t(`role.${agent.role}`), arabicName].filter(Boolean).join(" · ")}
        crumbs={[
          { label: tr("title"), href: "/residences" },
          { label: home.name, href: `/residences/${residenceId}` },
          { label: t("title"), href: `/residences/${residenceId}/staff` },
        ]}
        actions={
          editable ? (
            <>
              <StaffDialog
                residenceId={residenceId}
                agent={agent}
                categories={categories}
                today={today}
              />
              {agent.employed ? <EndStaffDialog staffId={agent.id} today={today} /> : null}
            </>
          ) : null
        }
      />
      <dl className="grid gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.monthlySalary")}</dt>
          <dd className="font-medium tabular-nums">
            <bdi dir="ltr">{money(agent.monthlySalary)}</bdi>
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.hiredOn")}</dt>
          <dd className="font-medium">{formatDate(agent.hiredOn)}</dd>
          {agent.leftOn ? (
            <dd className="text-xs text-muted-foreground">
              {t("leftOn", { date: formatDate(agent.leftOn) })}
            </dd>
          ) : null}
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.phone")}</dt>
          <dd className="font-medium">{agent.phone ? <PhoneText value={agent.phone} /> : "—"}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">{t("fields.categoryId")}</dt>
          <dd className="font-medium">{agent.categoryName ?? "—"}</dd>
        </div>
      </dl>
      {agent.notes ? (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{agent.notes}</p>
      ) : null}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("advances.title")}</CardTitle>
          {editable && agent.employed ? <AdvanceDialog staffId={agent.id} today={today} /> : null}
        </CardHeader>
        <CardContent>
          {agent.advances.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("advances.empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table data-testid="advances">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("advances.columns.paidOn")}</TableHead>
                    <TableHead>{t("advances.columns.month")}</TableHead>
                    <TableHead className="text-end">{t("advances.columns.amount")}</TableHead>
                    <TableHead>{t("advances.columns.by")}</TableHead>
                    {editable ? (
                      <TableHead>
                        <span className="sr-only">{t("advances.columns.actions")}</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agent.advances.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{formatDate(a.paidOn)}</TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {a.month.slice(5, 7)}/{a.month.slice(0, 4)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {money(a.amount)}
                      </TableCell>
                      <TableCell>{a.recordedByName}</TableCell>
                      {editable ? (
                        <TableCell className="text-end">
                          <ConfirmAction
                            action={deleteAdvanceAction}
                            input={{ advanceId: a.id }}
                            label={t("advances.delete")}
                            icon={<Trash2 data-icon="inline-start" />}
                            variant="ghost"
                            destructive
                            title={t("advances.deleteTitle")}
                            description={t("advances.deleteDescription")}
                            confirmLabel={t("advances.delete")}
                            successMessage={t("advances.deleted")}
                          />
                        </TableCell>
                      ) : null}
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
