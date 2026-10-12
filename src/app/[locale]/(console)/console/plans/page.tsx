import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import {
  ArchivePlanButton,
  CreatePlanDialog,
  RepriceAddonDialog,
} from "@/components/console/plan-forms";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toLocale } from "@/i18n/locales";
import { formatDZD, toDecimalString } from "@/lib/money";
import { addonModules } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";
import { requireOperator } from "@/server/console/guard";
import { listCatalog } from "@/server/console/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("console.plans");
  return { title: t("title") };
}

/** The catalog (CLAUDE.console.md §10): plans and add-ons, their prices, modules and caps. */
export default async function ConsolePlansPage({ params }: PageProps<"/[locale]/console/plans">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const operator = await requireOperator();
  const { plans, addons } = await listCatalog(operator);
  const t = await getTranslations("console.plans");
  const tm = await getTranslations("modules");
  const money = (v: bigint) => formatDZD(v, locale);
  const cap = (v: number | null) => (v === null ? t("unlimited") : String(v));
  const amount = (v: bigint) => toDecimalString(v).replace(".", ",");

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<CreatePlanDialog />}
      />

      <section className="space-y-2">
        <h2 className="px-4 text-footnote font-semibold text-muted-foreground">{t("plans")}</h2>
        <div className="overflow-x-auto rounded-xl bg-card shadow-card">
          <Table stack data-testid="plans">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.plan")}</TableHead>
                <TableHead>{t("columns.prices")}</TableHead>
                <TableHead>{t("columns.modules")}</TableHead>
                <TableHead>{t("columns.caps")}</TableHead>
                <TableHead>{t("columns.use")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id} className={cn(plan.archivedAt && "text-muted-foreground")}>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{locale === "ar" ? plan.nameAr : plan.nameFr}</div>
                    <div className="text-footnote text-muted-foreground" dir="ltr">
                      {plan.code}
                      {plan.archivedAt ? ` · ${t("archived")}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {plan.onQuote ? (
                      t("onQuote")
                    ) : (
                      <bdi dir="ltr">
                        {t("perYear", { amount: money(plan.yearlyPrice) })}
                        <br />
                        {t("perQuarter", { amount: money(plan.quarterlyPrice) })}
                      </bdi>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {plan.modules.map((m) => tm(`${m}.name`)).join(" · ")}
                  </TableCell>
                  <TableCell>
                    {t("caps", {
                      units: cap(plan.limits.activeUnits),
                      organizations: cap(plan.limits.organizations),
                    })}
                  </TableCell>
                  <TableCell>{t("accounts", { count: plan.subscriptions })}</TableCell>
                  <TableCell className="text-end">
                    {plan.archivedAt ? null : (
                      <ArchivePlanButton
                        planId={plan.id}
                        name={locale === "ar" ? plan.nameAr : plan.nameFr}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-4 text-footnote font-semibold text-muted-foreground">{t("addons")}</h2>
        <ul
          className="divide-y overflow-hidden rounded-xl bg-card shadow-card"
          data-testid="addons"
        >
          {addons
            .filter((a) => !a.archivedAt)
            .map((addon) => (
              <li key={addon.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {tm(`${addonModules[addon.code]}.name`)}
                  </div>
                  <div className="text-footnote text-muted-foreground">
                    {t(`basis.${addon.basis}`)}
                  </div>
                </div>
                <bdi dir="ltr" className="text-sm text-muted-foreground tabular-nums">
                  {addon.basis === "per_managed_lot"
                    ? money(addon.yearlyPrice)
                    : `${t("perYear", { amount: money(addon.yearlyPrice) })} · ${t("perQuarter", { amount: money(addon.quarterlyPrice) })}`}
                </bdi>
                <RepriceAddonDialog
                  code={addon.code}
                  name={tm(`${addonModules[addon.code]}.name`)}
                  yearly={amount(addon.yearlyPrice)}
                  quarterly={amount(addon.quarterlyPrice)}
                />
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
