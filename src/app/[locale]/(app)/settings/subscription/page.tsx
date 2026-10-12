import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ModuleList } from "@/components/subscription/module-list";
import { SubscriptionStatusBadge } from "@/components/subscription/subscription-status-badge";
import { toLocale } from "@/i18n/locales";
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { addonModules } from "@/lib/subscriptions";
import { requirePermission } from "@/server/auth/page-guard";
import { getTenantSubscription } from "@/server/entitlements/subscription";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("subscription");
  return { title: t("title") };
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 px-4 py-3">
      <div className="text-footnote text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-4 text-footnote font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The organization's subscription (CLAUDE.console.md §11, `subscription:read`: the gérant and
 * the comptable): its plan and options, the companies of the account, and the modules — which
 * the gérant switches off when the company does not use them.
 */
export default async function SubscriptionPage({
  params,
}: PageProps<"/[locale]/settings/subscription">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requirePermission("subscription:read");
  const { subscription, modules } = await getTenantSubscription(ctx);
  const t = await getTranslations("subscription");
  const tm = await getTranslations("modules");
  const money = (v: bigint) => formatDZD(v, locale);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title={t("title")} description={t("description")} />

      {subscription ? (
        <>
          <section className="space-y-4 rounded-2xl bg-card p-5 shadow-card" data-testid="plan">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-footnote text-muted-foreground">{t("plan")}</div>
                <div className="text-title">
                  {locale === "ar" ? subscription.plan.nameAr : subscription.plan.nameFr}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {subscription.program === "design_partner" ? (
                  <span className="inline-flex h-5.5 items-center rounded-full border border-purple/25 bg-purple-soft px-2.5 text-xs font-medium text-purple">
                    {t("designPartner")}
                  </span>
                ) : null}
                <SubscriptionStatusBadge status={subscription.status} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Figure label={t("price")}>
                {subscription.plan.onQuote && subscription.price === 0n ? (
                  t("onQuote")
                ) : (
                  <bdi dir="ltr">
                    {t(`perPeriod.${subscription.billingPeriod}`, {
                      amount: money(subscription.price),
                    })}
                  </bdi>
                )}
              </Figure>
              {subscription.discountBp > 0 ? (
                <Figure label={t("discount")}>
                  <bdi dir="ltr">{(subscription.discountBp / 100).toLocaleString(locale)} %</bdi>
                </Figure>
              ) : null}
              {subscription.status === "pilot" && subscription.pilotEndsOn ? (
                <Figure label={t("pilotEnds")}>{formatDate(subscription.pilotEndsOn)}</Figure>
              ) : null}
              {subscription.currentPeriodStart && subscription.currentPeriodEnd ? (
                <Figure label={t("period")}>
                  {t("periodRange", {
                    from: formatDate(subscription.currentPeriodStart),
                    to: formatDate(subscription.currentPeriodEnd),
                  })}
                </Figure>
              ) : null}
              {subscription.priceLockedUntil ? (
                <Figure label={t("priceLocked")}>
                  {formatDate(subscription.priceLockedUntil)}
                </Figure>
              ) : null}
            </div>
          </section>

          <Group title={t("addons.title")}>
            {subscription.addons.length === 0 ? (
              <p className="rounded-xl bg-card px-4 py-3 text-sm text-muted-foreground shadow-card">
                {t("addons.none")}
              </p>
            ) : (
              <ul
                className="divide-y overflow-hidden rounded-xl bg-card shadow-card"
                data-testid="addons"
              >
                {subscription.addons.map((addon) => (
                  <li
                    key={addon.code}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="text-sm font-medium">
                      {tm(`${addonModules[addon.code]}.name`)}
                    </span>
                    <bdi dir="ltr" className="text-sm text-muted-foreground tabular-nums">
                      {addon.code === "syndic"
                        ? t("addons.perLot", { amount: money(addon.price) })
                        : t(`perPeriod.${subscription.billingPeriod}`, {
                            amount: money(addon.price),
                          })}
                    </bdi>
                  </li>
                ))}
              </ul>
            )}
          </Group>

          <Group title={t("organizations.title")}>
            <ul
              className="divide-y overflow-hidden rounded-xl bg-card shadow-card"
              data-testid="account-organizations"
            >
              {subscription.organizations.map((org) => (
                <li key={org.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm font-medium">{org.name}</span>
                  {org.id === ctx.orgId ? (
                    <span className="text-footnote text-muted-foreground">
                      {t("organizations.current")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Group>
        </>
      ) : (
        <p className="empty-state" data-testid="no-subscription">
          {t("none")}
        </p>
      )}

      <Group title={t("modules.title")}>
        <ModuleList rows={modules} canSwitch={can(ctx, "organization:update")} />
        <p className="px-4 text-footnote text-muted-foreground">{t("modules.description")}</p>
      </Group>
    </div>
  );
}
