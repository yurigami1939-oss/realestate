import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ImportPanel } from "@/components/imports/import-panel";
import { LedgerFilters } from "@/components/treasury/ledger-filters";
import {
  ApplySuggestionsButton,
  DeleteStatementButton,
  StatementLineActions,
} from "@/components/treasury/reconciliation";
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
import { toLocale } from "@/i18n/locales";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getReconciliation } from "@/server/treasury/reconciliation";
import { ledgerParams } from "@/server/treasury/schemas";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/treasury/[accountId]/reconciliation">): Promise<Metadata> {
  const t = await getTranslations("treasury.reconciliation");
  const ctx = await requirePermission("treasury:read");
  const data = await getReconciliation(ctx, (await params).accountId, {});
  return { title: data ? `${t("title")} · ${data.account.name}` : t("title") };
}

/**
 * Rapprochement bancaire of a bank or CCP account over a period: the statement lines imported,
 * each matched with the ledger's entries (suggested when likely), booked or set aside; the
 * entries the bank has not shown yet.
 */
export default async function ReconciliationPage({
  params,
  searchParams,
}: PageProps<"/[locale]/treasury/[accountId]/reconciliation">) {
  const { locale: raw, accountId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("treasury:read");
  const filters = ledgerParams.parse(await searchParams);
  const data = await getReconciliation(ctx, accountId, filters);
  if (!data) notFound();
  const t = await getTranslations("treasury");
  const money = (v: bigint) => formatDZD(v, locale);
  const { account, totals } = data;
  const canUpdate = can(ctx.roles, "treasury:update");
  const stateBadge = {
    matched: (
      <Badge variant="outline" className="text-emerald-800">
        {t("reconciliation.state.matched")}
      </Badge>
    ),
    dismissed: <Badge variant="outline">{t("reconciliation.state.dismissed")}</Badge>,
    open: (
      <Badge variant="outline" className="text-amber-800">
        {t("reconciliation.state.open")}
      </Badge>
    ),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("reconciliation.title")}
        description={t("reconciliation.description")}
        crumbs={[
          { label: t("title"), href: "/treasury" },
          { label: account.name, href: `/treasury/${account.id}` },
        ]}
        actions={
          canUpdate && totals.suggested > 0 ? (
            <ApplySuggestionsButton
              accountId={account.id}
              from={data.from}
              to={data.to}
              count={totals.suggested}
            />
          ) : null
        }
      />

      {canUpdate ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("reconciliation.import")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("reconciliation.importHint")}</p>
            <ImportPanel kind="bank_statement" fixed={{ param: "account", id: account.id }} />
          </CardContent>
        </Card>
      ) : null}

      <LedgerFilters from={data.from} to={data.to} />

      <dl className="grid gap-4 text-sm sm:grid-cols-4" data-testid="reconciliation-totals">
        <div>
          <dt className="text-muted-foreground">{t("reconciliation.totals.lines")}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {t("reconciliation.totals.linesValue", {
              matched: totals.matched,
              lines: totals.lines,
            })}
          </dd>
          {totals.open > 0 ? (
            <dd className="text-amber-800">
              {t("reconciliation.totals.open", { count: totals.open })}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="text-muted-foreground">{t("reconciliation.totals.statement")}</dt>
          <dd className="tabular-nums" dir="ltr">
            +{money(totals.statementIn)} / −{money(totals.statementOut)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("reconciliation.totals.unmatched")}</dt>
          <dd className="tabular-nums" dir="ltr">
            +{money(totals.entriesIn)} / −{money(totals.entriesOut)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t("reconciliation.totals.ledgerBalance", { date: formatDate(data.to) })}
          </dt>
          <dd className="text-lg font-semibold tabular-nums" dir="ltr">
            {money(totals.ledgerBalance)}
          </dd>
        </div>
      </dl>

      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="statement-lines">
          <TableHeader>
            <TableRow>
              <TableHead>{t("ledger.columns.date")}</TableHead>
              <TableHead>{t("reconciliation.columns.line")}</TableHead>
              <TableHead className="text-end">{t("ledger.columns.in")}</TableHead>
              <TableHead className="text-end">{t("ledger.columns.out")}</TableHead>
              <TableHead>{t("reconciliation.columns.match")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("ledger.columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t("reconciliation.empty")}
                </TableCell>
              </TableRow>
            ) : null}
            {data.lines.map((line) => (
              <TableRow key={line.id} data-state={line.state}>
                <TableCell className="tabular-nums" dir="ltr">
                  {formatDate(line.bookedOn)}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {line.label}
                  {line.reference ? (
                    <span className="block text-xs text-muted-foreground">
                      <bdi dir="ltr">{line.reference}</bdi>
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {line.amount > 0n ? money(line.amount) : ""}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {line.amount < 0n ? money(-line.amount) : ""}
                </TableCell>
                <TableCell className="space-y-1 text-sm whitespace-normal">
                  {stateBadge[line.state]}
                  {line.matches.map((m) => (
                    <span key={m.key} className="block text-xs text-muted-foreground">
                      {m.on ? `${formatDate(m.on)} · ` : ""}
                      {m.label}
                    </span>
                  ))}
                  {line.state === "dismissed" && line.dismissalReason ? (
                    <span className="block text-xs text-muted-foreground">
                      {line.dismissalReason}
                    </span>
                  ) : null}
                  {line.state === "open" && line.suggestion ? (
                    <span className="block text-xs" data-testid="suggestion">
                      {line.suggestion.slip
                        ? t("reconciliation.suggestedSlip", { number: line.suggestion.slip })
                        : t("reconciliation.suggested")}{" "}
                      {line.suggestion.entries.map((e) => e.label).join(" · ")}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {canUpdate ? (
                    <StatementLineActions
                      line={{
                        id: line.id,
                        bookedOn: line.bookedOn,
                        label: line.label,
                        reference: line.reference,
                        amount: line.amount,
                        state: line.state,
                        suggestion: line.suggestion,
                      }}
                      candidates={data.candidates}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("reconciliation.unmatchedTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.unmatchedEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("reconciliation.allMatched")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="unmatched-entries">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("ledger.columns.date")}</TableHead>
                    <TableHead>{t("ledger.columns.label")}</TableHead>
                    <TableHead>{t("ledger.columns.reference")}</TableHead>
                    <TableHead className="text-end">{t("ledger.columns.in")}</TableHead>
                    <TableHead className="text-end">{t("ledger.columns.out")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.unmatchedEntries.map((e) => (
                    <TableRow key={e.key}>
                      <TableCell className="tabular-nums" dir="ltr">
                        {formatDate(e.on)}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <span className="me-2 text-xs text-muted-foreground">
                          {t(`source.${e.source}`)}
                        </span>
                        {e.label}
                        {e.pendingCheque ? (
                          <span className="block text-xs text-amber-800">
                            {t("ledger.pendingCheque")}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {e.reference ? <bdi dir="ltr">{e.reference}</bdi> : null}
                      </TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {e.amount > 0n ? money(e.amount) : ""}
                      </TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">
                        {e.amount < 0n ? money(-e.amount) : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {data.statements.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("reconciliation.statements")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {data.statements.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {t("reconciliation.statementLine", {
                      from: formatDate(s.fromOn),
                      to: formatDate(s.toOn),
                      count: s.lineCount,
                    })}
                    <span className="block text-xs text-muted-foreground">
                      {t("reconciliation.importedBy", {
                        name: s.importedByName,
                        date: formatDateTime(s.createdAt),
                      })}
                    </span>
                  </span>
                  {canUpdate && s.used === 0 ? <DeleteStatementButton statementId={s.id} /> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
