import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ExportButton } from "@/components/exports/export-button";
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
import { formatDZD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/page-guard";
import { listUnitAccounts } from "@/server/charges/queries";

import { ResidenceNav } from "../_components/residence-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("charges.accounts");
  return { title: t("title") };
}

export default async function ResidenceAccountsPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/accounts">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("charge:read");
  const accounts = await listUnitAccounts(ctx, residenceId);
  if (!accounts) notFound();
  const t = await getTranslations("charges.accounts");
  const tr = await getTranslations("residences");
  const moneyLocale = (await getLocale()) === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, moneyLocale);
  const { totals } = accounts;
  const tiles = [
    { key: "called", value: totals.called },
    { key: "paid", value: totals.paid },
    { key: "remaining", value: totals.remaining },
    { key: "overdue", value: totals.overdue },
    { key: "credit", value: totals.credit },
    { key: "reserveCollected", value: totals.reserveCollected },
  ] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={accounts.residence.name}
        description={accounts.residence.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
        actions={<ExportButton kind="charges" params={{ residence: residenceId }} />}
      />
      <ResidenceNav residenceId={residenceId} current="accounts" roles={ctx.roles} />
      <dl
        className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6"
        data-testid="accounts-totals"
      >
        {tiles.map((tile) => (
          <div key={tile.key} className="rounded-md border p-2">
            <dt className="text-muted-foreground">{t(`totals.${tile.key}`)}</dt>
            <dd
              className={cn(
                "font-medium tabular-nums",
                tile.key === "overdue" && tile.value > 0n && "text-red-700",
              )}
            >
              <bdi dir="ltr">{money(tile.value)}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        {t("reserveHint", { called: money(totals.reserveCalled) })}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="unit-accounts">
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.unit")}</TableHead>
              <TableHead>{t("columns.coOwner")}</TableHead>
              <TableHead className="text-end">{t("columns.called")}</TableHead>
              <TableHead className="text-end">{t("columns.paid")}</TableHead>
              <TableHead className="text-end">{t("columns.remaining")}</TableHead>
              <TableHead className="text-end">{t("columns.overdue")}</TableHead>
              <TableHead className="text-end">{t("columns.credit")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.rows.map((r) => (
              <TableRow key={r.unitId} data-unit={r.code}>
                <TableCell>
                  <Link
                    href={`/residences/${residenceId}/accounts/${r.unitId}`}
                    className="font-medium hover:underline"
                    dir="ltr"
                  >
                    {r.code}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-normal">
                  {r.coOwner ?? <span className="text-muted-foreground">{t("noCoOwner")}</span>}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(r.called)}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(r.paid)}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(r.remaining)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-end tabular-nums",
                    r.overdue > 0n && "font-medium text-red-700",
                  )}
                  dir="ltr"
                >
                  {r.overdue > 0n ? money(r.overdue) : "—"}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {r.credit > 0n ? money(r.credit) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>{t("columns.total")}</TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(totals.called)}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(totals.paid)}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(totals.remaining)}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(totals.overdue)}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(totals.credit)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
