import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
import { LedgerFilters } from "@/components/treasury/ledger-filters";
import {
  CancelMovementDialog,
  CashCountDialog,
  CloseAccountDialog,
  EditAccountDialog,
  MovementDialog,
} from "@/components/treasury/treasury-dialogs";
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
import { formatDate, formatDateTime, todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getAccountLedger, listAccounts } from "@/server/treasury/queries";
import { ledgerParams } from "@/server/treasury/schemas";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/treasury/[accountId]">): Promise<Metadata> {
  const ctx = await requirePermission("treasury:read");
  const ledger = await getAccountLedger(ctx, (await params).accountId, {});
  return { title: ledger?.account.name };
}

/**
 * An account's ledger (journal de caisse / de banque) over a period: the balance before it,
 * each collection and movement with the running balance, the cash counts.
 */
export default async function AccountPage({
  params,
  searchParams,
}: PageProps<"/[locale]/treasury/[accountId]">) {
  const { locale: raw, accountId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("treasury:read");
  const filters = ledgerParams.parse(await searchParams);
  const ledger = await getAccountLedger(ctx, accountId, filters);
  if (!ledger) notFound();
  const t = await getTranslations("treasury");
  const tm = await getTranslations("payments.method");
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();
  const { account } = ledger;
  const open = account.closedOn === null;
  const canUpdate = open && can(ctx.roles, "treasury:update");
  const accounts = canUpdate ? (await listAccounts(ctx)).filter((a) => a.closedOn === null) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={account.name}
        crumbs={[{ label: t("title"), href: "/treasury" }]}
        badge={
          <>
            <Badge variant="outline">{t(`kind.${account.kind}`)}</Badge>
            {account.isDefault ? <Badge variant="secondary">{t("accounts.default")}</Badge> : null}
            {account.closedOn ? (
              <Badge variant="outline">
                {t("accounts.closedOn", { date: formatDate(account.closedOn) })}
              </Badge>
            ) : null}
          </>
        }
        actions={
          <>
            <ExportButton
              kind="ledger"
              params={{ account: account.id, from: ledger.from, to: ledger.to }}
            />
            {canUpdate ? (
              <MovementDialog
                accounts={accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))}
                accountId={account.id}
                today={today}
              />
            ) : null}
            {open && account.kind === "cash" && can(ctx.roles, "treasury:count") ? (
              <CashCountDialog accountId={account.id} balance={ledger.balance} today={today} />
            ) : null}
            {canUpdate ? <EditAccountDialog account={account} /> : null}
            {canUpdate ? <CloseAccountDialog accountId={account.id} today={today} /> : null}
          </>
        }
      />

      <dl className="flex flex-wrap gap-6 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("ledger.balance")}</dt>
          <dd className="text-2xl font-semibold tabular-nums" dir="ltr" data-testid="balance">
            {money(ledger.balance)}
          </dd>
        </div>
        {ledger.pendingCheques > 0n ? (
          <div>
            <dt className="text-muted-foreground">{t("ledger.pendingCheques")}</dt>
            <dd className="text-lg text-amber-800 tabular-nums" dir="ltr">
              {money(ledger.pendingCheques)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground">{t("ledger.opening")}</dt>
          <dd className="tabular-nums" dir="ltr">
            {money(account.openingBalance)} · {formatDate(account.openingOn)}
          </dd>
        </div>
        {account.bankName || account.accountNumber ? (
          <div>
            <dt className="text-muted-foreground">{t("fields.accountNumber")}</dt>
            <dd>
              {account.bankName}{" "}
              {account.accountNumber ? <bdi dir="ltr">{account.accountNumber}</bdi> : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <LedgerFilters from={ledger.from} to={ledger.to} />

      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="ledger">
          <TableHeader>
            <TableRow>
              <TableHead>{t("ledger.columns.date")}</TableHead>
              <TableHead>{t("ledger.columns.label")}</TableHead>
              <TableHead>{t("ledger.columns.reference")}</TableHead>
              <TableHead className="text-end">{t("ledger.columns.in")}</TableHead>
              <TableHead className="text-end">{t("ledger.columns.out")}</TableHead>
              <TableHead className="text-end">{t("ledger.columns.balance")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("ledger.columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40">
              <TableCell className="tabular-nums" dir="ltr">
                {formatDate(ledger.from)}
              </TableCell>
              <TableCell colSpan={4} className="text-muted-foreground">
                {t("ledger.before")}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(ledger.before)}
              </TableCell>
              <TableCell />
            </TableRow>
            {ledger.lines.map((line) => (
              <TableRow key={line.key} data-source={line.source}>
                <TableCell className="tabular-nums" dir="ltr">
                  {formatDate(line.on)}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <span className="me-2 text-xs text-muted-foreground">
                    {t(`source.${line.source}`)}
                  </span>
                  {line.href ? (
                    <Link href={line.href} className="hover:underline">
                      {line.label}
                    </Link>
                  ) : (
                    line.label
                  )}
                  {line.method ? (
                    <span className="block text-xs text-muted-foreground">
                      {tm(line.method)}
                      {line.pendingCheque ? ` · ${t("ledger.pendingCheque")}` : ""}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {line.reference ? <bdi dir="ltr">{line.reference}</bdi> : "—"}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {line.amountIn > 0n ? money(line.amountIn) : ""}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {line.amountOut > 0n ? money(line.amountOut) : ""}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(line.balance)}
                </TableCell>
                <TableCell>
                  {canUpdate && line.movementId ? (
                    <CancelMovementDialog movementId={line.movementId} />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>
                {t("ledger.closing", { date: formatDate(ledger.to) })}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(ledger.totalIn)}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(ledger.totalOut)}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr" data-testid="ledger-closing">
                {money(ledger.closing)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {ledger.counts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("counts.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="cash-counts">
              {ledger.counts.map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {formatDate(c.countedOn)} · {c.countedByName}
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(c.createdAt)}
                      {c.note ? ` · ${c.note}` : ""}
                    </span>
                  </span>
                  <span className="text-end tabular-nums" dir="ltr">
                    {money(c.counted)}
                    <span
                      className={
                        c.difference === 0n
                          ? "block text-xs text-emerald-800"
                          : "block text-xs text-amber-800"
                      }
                    >
                      {c.difference === 0n
                        ? t("counts.balancedShort")
                        : t("counts.differenceShort", { amount: money(c.difference) })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
