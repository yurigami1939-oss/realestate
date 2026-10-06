import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { CreateAccountDialog, MovementDialog } from "@/components/treasury/treasury-dialogs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { treasuryAccountKinds } from "@/lib/treasury";
import { requirePermission } from "@/server/auth/page-guard";
import { listAccounts } from "@/server/treasury/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("treasury");
  return { title: t("title") };
}

/**
 * Trésorerie (CLAUDE.md §7 Treasury): every cash desk and account with today's balance, what
 * came in and went out today and the cheques not cleared yet; totals per kind.
 */
export default async function TreasuryPage({ params }: PageProps<"/[locale]/treasury">) {
  const { locale: raw } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("treasury:read");
  const accounts = await listAccounts(ctx);
  const t = await getTranslations("treasury");
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();
  const open = accounts.filter((a) => a.closedOn === null);
  const canUpdate = can(ctx.roles, "treasury:update");
  const totals = treasuryAccountKinds
    .map((kind) => ({
      kind,
      total: open.filter((a) => a.kind === kind).reduce((sum, a) => sum + a.balance, 0n),
      count: open.filter((a) => a.kind === kind).length,
    }))
    .filter((k) => k.count > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canUpdate ? (
            <>
              {open.length > 0 ? (
                <MovementDialog
                  accounts={open.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))}
                  today={today}
                />
              ) : null}
              <CreateAccountDialog today={today} />
            </>
          ) : null
        }
      />
      {totals.length > 0 ? (
        <dl className="flex flex-wrap gap-6 text-sm" data-testid="treasury-totals">
          {totals.map((k) => (
            <div key={k.kind}>
              <dt className="text-muted-foreground">{t(`totals.${k.kind}`)}</dt>
              <dd className="text-lg font-semibold tabular-nums" dir="ltr">
                {money(k.total)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {accounts.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="treasury-accounts">
          {accounts.map((a) => (
            <Card
              key={a.id}
              data-account={a.name}
              className={a.closedOn ? "opacity-60" : undefined}
            >
              <CardHeader className="space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Link href={`/treasury/${a.id}`} className="hover:underline">
                    {a.name}
                  </Link>
                  <Badge variant="outline">{t(`kind.${a.kind}`)}</Badge>
                  {a.isDefault ? <Badge variant="secondary">{t("accounts.default")}</Badge> : null}
                  {a.closedOn ? (
                    <Badge variant="outline">
                      {t("accounts.closedOn", { date: formatDate(a.closedOn) })}
                    </Badge>
                  ) : null}
                </CardTitle>
                {a.bankName || a.accountNumber ? (
                  <p className="text-xs text-muted-foreground">
                    {a.bankName}
                    {a.accountNumber ? (
                      <>
                        {" · "}
                        <bdi dir="ltr">{a.accountNumber}</bdi>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div
                  className="text-2xl font-semibold tabular-nums"
                  dir="ltr"
                  data-testid="balance"
                >
                  {money(a.balance)}
                </div>
                <div className="text-muted-foreground">
                  {t("accounts.today", { in: money(a.inOn), out: money(a.outOn) })}
                </div>
                {a.pendingCheques > 0n ? (
                  <div className="text-amber-800">
                    {t("accounts.pendingCheques", { amount: money(a.pendingCheques) })}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
