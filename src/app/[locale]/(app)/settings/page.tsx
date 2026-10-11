import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { settingsGroups, visibleItems } from "@/components/app-shell/nav-items";
import { PageHeader } from "@/components/app-shell/page-header";
import { SettingsTile } from "@/components/settings/settings-tile";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { accessOf } from "@/lib/permissions";
import { requireTenantCtx } from "@/server/auth/page-guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("settings") };
}

/** The settings hub: every settings page the member may open, grouped (like System Settings). */
export default async function SettingsPage({ params }: PageProps<"/[locale]/settings">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requireTenantCtx();
  const access = accessOf(ctx);
  const t = await getTranslations();
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader title={t("nav.settings")} description={t("settingsHub.description")} />
      {settingsGroups.map((group) => {
        const items = visibleItems(group.items, access, false);
        if (items.length === 0) return null;
        return (
          <section key={group.id} className="space-y-2" data-testid={`settings-${group.id}`}>
            <h2 className="px-4 text-footnote font-semibold text-muted-foreground">
              {t(`settingsHub.groups.${group.id}`)}
            </h2>
            <ul className="overflow-hidden rounded-xl bg-card shadow-card">
              {items.map((item) => (
                <li
                  key={item.href}
                  className="relative not-last:after:absolute not-last:after:start-15 not-last:after:end-0 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-border"
                >
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <SettingsTile item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{t(`nav.${item.key}`)}</span>
                      <span className="block truncate text-footnote text-muted-foreground">
                        {t(`settingsHub.items.${item.key as SettingsKey}`)}
                      </span>
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground/70 rtl:rotate-180"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

type SettingsKey =
  | "security"
  | "notifications"
  | "company"
  | "members"
  | "customRoles"
  | "documentTexts"
  | "paymentGateway"
  | "leadCapture"
  | "whatsappSettings"
  | "smsSettings"
  | "exports"
  | "imports"
  | "privacy"
  | "audit";
