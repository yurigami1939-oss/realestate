import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
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
import { getCallsSetup } from "@/server/charges/queries";
import { getWorksCallChoices } from "@/server/charges/works";

import { ResidenceNav } from "../_components/residence-nav";

import { IssueDialog } from "./_components/issue-dialog";
import { WorksCallDialog } from "./_components/works-call-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("charges.calls");
  return { title: t("title") };
}

export default async function ResidenceCallsPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/calls">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("charge:read");
  const setup = await getCallsSetup(ctx, residenceId);
  if (!setup) notFound();
  const t = await getTranslations("charges.calls");
  const tp = await getTranslations("charges.period");
  const tr = await getTranslations("residences");
  const moneyLocale = (await getLocale()) === "ar" ? "ar" : "fr";
  const canIssue = can(ctx.roles, "charge:create");
  const works = canIssue ? await getWorksCallChoices(ctx, residenceId) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={setup.residence.name}
        description={setup.residence.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
      />
      <ResidenceNav residenceId={residenceId} current="calls" roles={ctx.roles} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {works && works.categories.length > 0 ? (
              <WorksCallDialog
                residenceId={residenceId}
                categories={works.categories}
                resolutions={works.resolutions}
                today={todayInAlgiers()}
                callDueDays={setup.residence.callDueDays}
              />
            ) : null}
            {canIssue && setup.toIssue.length > 0 ? (
              <IssueDialog
                residenceId={residenceId}
                toIssue={setup.toIssue}
                today={todayInAlgiers()}
                callDueDays={setup.residence.callDueDays}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {canIssue && setup.toIssue.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("nothingToIssue")}</p>
          ) : null}
          {setup.periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table data-testid="charge-periods">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.period")}</TableHead>
                    <TableHead>{t("columns.issuedOn")}</TableHead>
                    <TableHead>{t("columns.dueOn")}</TableHead>
                    <TableHead className="text-end">{t("columns.calls")}</TableHead>
                    <TableHead className="text-end">{t("columns.total")}</TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {setup.periods.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link
                          href={`/residences/${residenceId}/calls/${p.id}`}
                          className="font-medium hover:underline"
                        >
                          {p.frequency && p.periodIndex
                            ? tp(p.frequency, { year: p.year, index: p.periodIndex })
                            : p.title}
                        </Link>
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {formatDate(p.issuedOn)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {formatDate(p.dueOn)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{p.callCount}</TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {formatDZD(p.total, moneyLocale)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === "issued" ? "secondary" : "outline"}>
                          {t(`status.${p.status}`)}
                        </Badge>
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
