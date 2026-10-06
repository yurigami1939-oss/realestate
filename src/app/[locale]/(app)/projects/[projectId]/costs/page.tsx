import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { BudgetDialog } from "@/components/costs/budget-dialog";
import { ContractDialog, ContractorDialog } from "@/components/costs/cost-dialogs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { formatDZD, toDecimalString } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getProjectCosts, listContractorChoices } from "@/server/costs/queries";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/projects/[projectId]/costs">): Promise<Metadata> {
  const t = await getTranslations("costs");
  const ctx = await requirePermission("cost:read");
  const costs = await getProjectCosts(ctx, (await params).projectId);
  return { title: costs ? `${t("title")} · ${costs.project.name}` : t("title") };
}

const stateTone = {
  active: "",
  provisional: "text-amber-800",
  final: "text-emerald-800",
  terminated: "text-red-800",
} as const;

/**
 * The costs of a project (CLAUDE.md §7 Construction costs): margin, budget against what is
 * committed, invoiced and paid per category, the contracts and the 12-month cash-flow forecast.
 */
export default async function ProjectCostsPage({
  params,
}: PageProps<"/[locale]/projects/[projectId]/costs">) {
  const { locale: raw, projectId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("cost:read");
  const costs = await getProjectCosts(ctx, projectId);
  if (!costs) notFound();
  const t = await getTranslations("costs");
  const ti = await getTranslations("inventory");
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();
  const canUpdate = can(ctx.roles, "cost:update");
  const contractors = canUpdate ? await listContractorChoices(ctx) : [];
  const { revenue, totals } = costs;
  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ-u-nu-latn" : "fr-DZ", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${month}-01T00:00:00Z`));

  const summary: {
    key: "signed" | "collected" | "stock" | "revenue" | "cost" | "margin";
    value: bigint;
    tone?: string;
  }[] = [
    { key: "signed", value: revenue.signed },
    { key: "collected", value: revenue.collected },
    { key: "stock", value: revenue.revenue - revenue.signed },
    { key: "revenue", value: revenue.revenue },
    { key: "cost", value: revenue.cost },
    {
      key: "margin",
      value: revenue.margin,
      tone: revenue.margin < 0n ? "text-red-800" : "text-emerald-800",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        crumbs={[
          { label: ti("projects.title"), href: "/projects" },
          { label: costs.project.name, href: `/projects/${costs.project.id}` },
        ]}
        actions={
          canUpdate ? (
            <>
              <BudgetDialog
                projectId={costs.project.id}
                lines={costs.budget.map((l) => ({
                  category: l.category,
                  label: l.label,
                  amount: toDecimalString(l.amount).replace(".", ","),
                }))}
              />
              <ContractorDialog />
              {contractors.length > 0 ? (
                <ContractDialog
                  projectId={costs.project.id}
                  contractors={contractors}
                  today={today}
                />
              ) : null}
            </>
          ) : null
        }
      />

      <dl
        className="grid gap-4 rounded-lg border p-4 text-sm sm:grid-cols-3 lg:grid-cols-6"
        data-testid="costs-summary"
      >
        {summary.map((s) => (
          <div key={s.key}>
            <dt className="text-muted-foreground">{t(`summary.${s.key}`)}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${s.tone ?? ""}`} dir="ltr">
              {money(s.value)}
            </dd>
          </div>
        ))}
      </dl>
      {revenue.rateBp !== null ? (
        <p className="text-sm text-muted-foreground" data-testid="margin-rate">
          {t("summary.rate", { rate: formatShare(revenue.rateBp) })}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("budget.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table data-testid="costs-by-category">
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.category")}</TableHead>
                <TableHead className="text-end">{t("columns.budget")}</TableHead>
                <TableHead className="text-end">{t("columns.committed")}</TableHead>
                <TableHead className="text-end">{t("columns.invoiced")}</TableHead>
                <TableHead className="text-end">{t("columns.paid")}</TableHead>
                <TableHead className="text-end">{t("columns.gap")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costs.byCategory
                .filter((c) => c.budget > 0n || c.committed > 0n)
                .map((c) => (
                  <TableRow key={c.category} data-category={c.category}>
                    <TableCell>{t(`category.${c.category}`)}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(c.budget)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(c.committed)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(c.invoiced)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(c.paid)}
                    </TableCell>
                    <TableCell
                      className={`text-end tabular-nums ${c.committed > c.budget ? "text-red-800" : ""}`}
                      dir="ltr"
                    >
                      {money(c.budget - c.committed)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t("columns.total")}</TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(totals.budget)}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(totals.committed)}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(totals.invoiced)}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(totals.paid)}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(totals.budget - totals.committed)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          {totals.retentionHeld > 0n || totals.unpaid > 0n ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("budget.owed", {
                unpaid: money(totals.unpaid),
                retention: money(totals.retentionHeld),
              })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("contracts.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {costs.contracts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("contracts.empty")}</p>
          ) : (
            <Table data-testid="contracts">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fields.title")}</TableHead>
                  <TableHead>{t("fields.contractor")}</TableHead>
                  <TableHead className="text-end">{t("fields.contractAmount")}</TableHead>
                  <TableHead className="text-end">{t("columns.invoiced")}</TableHead>
                  <TableHead className="text-end">{t("columns.paid")}</TableHead>
                  <TableHead className="text-end">{t("columns.retention")}</TableHead>
                  <TableHead>{t("columns.state")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.contracts.map((c) => (
                  <TableRow key={c.id} data-contract={c.title}>
                    <TableCell className="whitespace-normal">
                      <Link
                        href={`/projects/${costs.project.id}/costs/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.title}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {t(`category.${c.category}`)}
                        {c.reference ? (
                          <>
                            {" · "}
                            <bdi dir="ltr">{c.reference}</bdi>
                          </>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-normal">{c.supplierName}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(c.amount)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(c.invoiced)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(c.paid)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(c.retentionHeld)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={stateTone[c.state]}>
                        {t(`state.${c.state}`)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("forecast.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("forecast.description")}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="overflow-x-auto">
            <Table data-testid="cash-forecast">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("forecast.month")}</TableHead>
                  <TableHead className="text-end">{t("forecast.in")}</TableHead>
                  <TableHead className="text-end">{t("forecast.out")}</TableHead>
                  <TableHead className="text-end">{t("forecast.net")}</TableHead>
                  <TableHead className="text-end">{t("forecast.cumulative")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.forecast.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{monthLabel(m.month)}</TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(m.expectedIn)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(m.expectedOut)}
                    </TableCell>
                    <TableCell
                      className={`text-end tabular-nums ${m.net < 0n ? "text-red-800" : ""}`}
                      dir="ltr"
                    >
                      {money(m.net)}
                    </TableCell>
                    <TableCell
                      className={`text-end tabular-nums ${m.cumulative < 0n ? "text-red-800" : ""}`}
                      dir="ltr"
                    >
                      {money(m.cumulative)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("forecast.notes", {
              undated: money(costs.undatedIn),
              laterIn: money(costs.laterIn),
              laterOut: money(costs.laterOut),
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
