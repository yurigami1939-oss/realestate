import { Search } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { SubscriptionStatusBadge } from "@/components/subscription/subscription-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatDate } from "@/lib/dates";
import {
  type SubscriptionProgram,
  subscriptionPrograms,
  type SubscriptionStatus,
  subscriptionStatuses,
} from "@/lib/subscriptions";
import { requireOperator } from "@/server/console/guard";
import { listAccounts, listCatalog } from "@/server/console/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("console.accounts");
  return { title: t("title") };
}

const pick = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

/** The client accounts (CLAUDE.console.md §10): searched by name, filtered by state, plan, program. */
export default async function ConsoleAccountsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/console/accounts">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const operator = await requireOperator();
  const query = await searchParams;
  const { plans } = await listCatalog(operator);
  const filters = {
    q: typeof query.q === "string" ? query.q : undefined,
    status: pick<SubscriptionStatus>(subscriptionStatuses, query.status),
    plan: pick(
      plans.map((p) => p.code),
      query.plan,
    ),
    program: pick<SubscriptionProgram>(subscriptionPrograms, query.program),
  };
  const rows = await listAccounts(operator, filters);
  const t = await getTranslations("console");
  const ts = await getTranslations("subscription.status");
  const select =
    "h-9 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={t("accounts.title")} description={t("accounts.description")} />
      <form method="get" className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={t("accounts.search")}
            aria-label={t("accounts.search")}
            className="ps-8"
          />
        </div>
        <select
          name="status"
          defaultValue={filters.status ?? ""}
          className={select}
          aria-label={t("accounts.columns.status")}
        >
          <option value="">{t("accounts.allStatuses")}</option>
          {subscriptionStatuses.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </select>
        <select
          name="plan"
          defaultValue={filters.plan ?? ""}
          className={select}
          aria-label={t("accounts.columns.plan")}
        >
          <option value="">{t("accounts.allPlans")}</option>
          {plans.map((p) => (
            <option key={p.id} value={p.code}>
              {locale === "ar" ? p.nameAr : p.nameFr}
            </option>
          ))}
        </select>
        <select
          name="program"
          defaultValue={filters.program ?? ""}
          className={select}
          aria-label={t("accounts.columns.program")}
        >
          <option value="">{t("accounts.allPrograms")}</option>
          {subscriptionPrograms.map((p) => (
            <option key={p} value={p}>
              {t(`programs.${p}`)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          {t("accounts.filter")}
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="empty-state">{t("accounts.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card shadow-card">
          <Table stack data-testid="accounts">
            <TableHeader>
              <TableRow>
                <TableHead>{t("accounts.columns.account")}</TableHead>
                <TableHead>{t("accounts.columns.plan")}</TableHead>
                <TableHead>{t("accounts.columns.status")}</TableHead>
                <TableHead>{t("accounts.columns.program")}</TableHead>
                <TableHead>{t("accounts.columns.until")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-normal">
                    <Link
                      href={`/console/accounts/${row.id}`}
                      data-row-link
                      className="font-medium hover:underline"
                    >
                      {row.legalName}
                    </Link>
                    <div className="text-footnote text-muted-foreground">{row.companies}</div>
                  </TableCell>
                  <TableCell>{locale === "ar" ? row.planNameAr : row.planNameFr}</TableCell>
                  <TableCell>
                    <SubscriptionStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>{t(`programs.${row.program}`)}</TableCell>
                  <TableCell className="tabular-nums">
                    {row.status === "pilot" && row.pilotEndsOn
                      ? t("accounts.pilotUntil", { date: formatDate(row.pilotEndsOn) })
                      : row.currentPeriodEnd
                        ? t("accounts.periodUntil", { date: formatDate(row.currentPeriodEnd) })
                        : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
