import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { AccountBilling } from "@/components/console/account-billing";
import {
  AccountIdentityForm,
  AddonsEditor,
  PilotGoals,
  StatusActions,
  SubscriptionTermsForm,
} from "@/components/console/account-forms";
import { ProvisionDialog } from "@/components/console/provision-forms";
import { SupportDialog } from "@/components/console/support-dialog";
import { SubscriptionStatusBadge } from "@/components/subscription/subscription-status-badge";
import { toLocale } from "@/i18n/locales";
import { formatDate, formatDateTime, todayInAlgiers } from "@/lib/dates";
import { formatDZD, formatPercentInput, toDecimalString } from "@/lib/money";
import { isUuid } from "@/lib/ids";
import { modules as allModules } from "@/lib/modules";
import { addonCodes } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";
import { requireOperator } from "@/server/console/guard";
import { getAccount, listCatalog } from "@/server/console/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("console.accounts");
  return { title: t("title") };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-4 text-footnote font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A client account (CLAUDE.console.md §10): its state and the operator's decisions, the
 * subscription's terms and add-ons, the companies with their modules, the pilot's goals, the
 * invoicing identity and the console's trail.
 */
export default async function ConsoleAccountPage({
  params,
}: PageProps<"/[locale]/console/accounts/[accountId]">) {
  const { locale: raw, accountId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const operator = await requireOperator();
  if (!isUuid(accountId)) notFound();
  const found = await getAccount(operator, accountId);
  if (!found) notFound();
  const { account, subscription, plan, addons, organizations, goals, trail, usage } = found;
  const tu = await getTranslations("console.account.usage");
  const sumOf = (
    key:
      | "activeUnits"
      | "managedLots"
      | "storageBytes"
      | "receipts30d"
      | "reminders30d"
      | "activeMembers30d"
      | "leads30d",
  ) => usage.reduce((total, row) => total + Number(row[key]), 0);
  const tg = await getTranslations("subscription.usage");
  const gb = (bytes: number) =>
    tg("gb", { value: (Math.round((bytes / 1e9) * 10) / 10).toLocaleString(locale) });
  const measuredOn = usage
    .map((u) => u.measuredOn)
    .sort()
    .at(-1);
  const { plans, addons: catalog } = await listCatalog(operator);
  const t = await getTranslations("console");
  const tm = await getTranslations("modules");
  const money = (v: bigint) => formatDZD(v, locale);
  const amount = (v: bigint) => toDecimalString(v).replace(".", ",");
  const opt = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const trailLabel = (action: string) => {
    const key = `account.trail.actions.${action}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : action;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title={account.legalName}
        description={organizations.map((o) => o.name).join(" · ")}
        actions={
          <StatusActions
            billingAccountId={account.id}
            status={subscription.status}
            activated={subscription.activatedAt !== null}
            today={todayInAlgiers()}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SubscriptionStatusBadge status={subscription.status} />
        <span className="text-sm text-muted-foreground">
          {locale === "ar" ? plan.nameAr : plan.nameFr} · {t(`programs.${subscription.program}`)}
          {subscription.statusReason ? ` · ${subscription.statusReason}` : ""}
        </span>
      </div>

      <Section title={t("account.subscription.title")}>
        <div className="rounded-2xl bg-card p-5 shadow-card">
          <SubscriptionTermsForm
            plans={plans
              .filter((p) => !p.archivedAt || p.id === plan.id)
              .map((p) => ({ code: p.code, name: locale === "ar" ? p.nameAr : p.nameFr }))}
            defaults={{
              billingAccountId: account.id,
              planCode: plan.code,
              billingPeriod: subscription.billingPeriod,
              price: amount(subscription.price),
              discount: subscription.discountBp ? formatPercentInput(subscription.discountBp) : "",
              priceLockedUntil: subscription.priceLockedUntil ?? "",
              pilotEndsOn: subscription.pilotEndsOn ?? "",
              graceDays: String(subscription.graceDays),
              activeUnits: opt(subscription.limitOverrides.activeUnits),
              organizations: opt(subscription.limitOverrides.organizations),
              storageGb: opt(subscription.limitOverrides.storageGb),
            }}
          />
        </div>
      </Section>

      <Section title={t("account.addons.title")}>
        <AddonsEditor
          billingAccountId={account.id}
          rows={addonCodes.map((code) => {
            const live = addons.find((a) => a.addonCode === code && a.removedOn === null);
            const offer = catalog.find((c) => c.code === code && !c.archivedAt);
            const price = offer
              ? subscription.billingPeriod === "yearly"
                ? offer.yearlyPrice
                : offer.quarterlyPrice
              : 0n;
            return {
              code,
              on: Boolean(live),
              price: live ? amount(live.price) : "",
              since: live?.addedOn ?? null,
              catalog:
                offer?.basis === "per_managed_lot"
                  ? `${money(price)} ${t("account.addons.perLot")}`
                  : t(
                      subscription.billingPeriod === "yearly"
                        ? "plans.perYear"
                        : "plans.perQuarter",
                      {
                        amount: money(price),
                      },
                    ),
            };
          })}
        />
      </Section>

      <Section title={t("billing.title")}>
        <AccountBilling operator={operator} billingAccountId={account.id} locale={locale} />
      </Section>

      <Section title={t("account.organizations.title")}>
        <div className="flex justify-end">
          <ProvisionDialog plans={[]} billingAccountId={account.id} />
        </div>
        <ul
          className="divide-y overflow-hidden rounded-xl bg-card shadow-card"
          data-testid="account-organizations"
        >
          {organizations.map((org) => (
            <li key={org.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium">{org.name}</div>
                  <div className="text-footnote text-muted-foreground">
                    {org.owners.length > 0
                      ? org.owners.map((o) => `${o.name} · ${o.email}`).join(", ")
                      : t("account.organizations.noOwner")}
                  </div>
                </div>
                <SupportDialog
                  organization={{ id: org.id, name: org.name }}
                  members={org.members.map(({ userId, name, email }) => ({ userId, name, email }))}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allModules
                  .filter((m) => org.modules.includes(m) || org.disabled.includes(m))
                  .map((m) => {
                    const off = org.disabled.includes(m);
                    return (
                      <span
                        key={m}
                        title={off ? t("account.organizations.off") : undefined}
                        className={cn(
                          "inline-flex h-5.5 items-center rounded-full border px-2 text-xs",
                          off
                            ? "border-border bg-muted text-muted-foreground line-through"
                            : "border-info/25 bg-info-soft text-info",
                        )}
                      >
                        {tm(`${m}.name`)}
                      </span>
                    );
                  })}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={tu("title")}>
        {usage.length === 0 ? (
          <p className="empty-state">{tu("notMeasured")}</p>
        ) : (
          <div
            className="overflow-x-auto rounded-xl bg-card shadow-card"
            data-testid="account-usage"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="text-footnote text-muted-foreground">
                  <th className="px-4 py-2 text-start font-medium" />
                  <th className="px-4 py-2 text-end font-medium">{tu("activeUnits")}</th>
                  <th className="px-4 py-2 text-end font-medium">{tu("managedLots")}</th>
                  <th className="px-4 py-2 text-end font-medium">{tu("storage")}</th>
                  <th className="px-4 py-2 text-end font-medium">{tu("members")}</th>
                  <th className="px-4 py-2 text-end font-medium">{tu("portal")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {organizations.map((org) => {
                  const row = usage.find((u) => u.organizationId === org.id);
                  return (
                    <tr key={org.id} className="tabular-nums">
                      <td className="px-4 py-2 font-medium">{org.name}</td>
                      <td className="px-4 py-2 text-end">{row?.activeUnits ?? "—"}</td>
                      <td className="px-4 py-2 text-end">{row?.managedLots ?? "—"}</td>
                      <td className="px-4 py-2 text-end">{row ? gb(row.storageBytes) : "—"}</td>
                      <td className="px-4 py-2 text-end">{row?.staffMembers ?? "—"}</td>
                      <td className="px-4 py-2 text-end">{row?.portalAccounts ?? "—"}</td>
                    </tr>
                  );
                })}
                {organizations.length > 1 ? (
                  <tr className="font-semibold tabular-nums">
                    <td className="px-4 py-2">{tu("total")}</td>
                    <td className="px-4 py-2 text-end">{sumOf("activeUnits")}</td>
                    <td className="px-4 py-2 text-end">{sumOf("managedLots")}</td>
                    <td className="px-4 py-2 text-end">{gb(sumOf("storageBytes"))}</td>
                    <td className="px-4 py-2 text-end" />
                    <td className="px-4 py-2 text-end" />
                  </tr>
                ) : null}
              </tbody>
            </table>
            {measuredOn ? (
              <p className="border-t px-4 py-2 text-footnote text-muted-foreground">
                {tu("measuredOn", { date: formatDate(measuredOn) })}
              </p>
            ) : null}
          </div>
        )}
      </Section>

      {subscription.activatedAt === null || goals.length > 0 ? (
        <Section title={t("account.pilot.title")}>
          {usage.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="pilot-indicators">
              {(
                [
                  ["receipts", "receipts30d"],
                  ["reminders", "reminders30d"],
                  ["activeMembers", "activeMembers30d"],
                  ["leads", "leads30d"],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="rounded-lg bg-card px-4 py-3 shadow-card">
                  <div className="text-footnote text-muted-foreground">{tu(label)}</div>
                  <div className="text-title tabular-nums">{sumOf(key)}</div>
                </div>
              ))}
            </div>
          ) : null}
          <PilotGoals
            billingAccountId={account.id}
            goals={goals.map((g) => ({ id: g.id, label: g.label, doneOn: g.doneOn }))}
          />
        </Section>
      ) : null}

      <Section title={t("account.identity.title")}>
        <div className="rounded-2xl bg-card p-5 shadow-card">
          <AccountIdentityForm
            defaults={{
              billingAccountId: account.id,
              legalName: account.legalName,
              address: account.address ?? "",
              wilaya: account.wilaya ?? "",
              rcNumber: account.rcNumber ?? "",
              nif: account.nif ?? "",
              nis: account.nis ?? "",
              aiNumber: account.aiNumber ?? "",
              contactName: account.contactName ?? "",
              email: account.email ?? "",
              phone: account.phone ?? "",
              notes: account.notes ?? "",
            }}
          />
        </div>
      </Section>

      <Section title={t("account.trail.title")}>
        {trail.length === 0 ? (
          <p className="empty-state">{t("account.trail.empty")}</p>
        ) : (
          <ul
            className="divide-y overflow-hidden rounded-xl bg-card shadow-card"
            data-testid="console-trail"
          >
            {trail.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5"
              >
                <span className="text-sm">
                  <span className="font-medium">{trailLabel(row.action)}</span>
                  {row.reason ? (
                    <span className="text-muted-foreground"> · {row.reason}</span>
                  ) : null}
                </span>
                <span className="text-footnote text-muted-foreground tabular-nums">
                  {row.actorName ?? t("account.trail.system")} ·{" "}
                  <bdi dir="ltr">{formatDateTime(row.createdAt)}</bdi>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
