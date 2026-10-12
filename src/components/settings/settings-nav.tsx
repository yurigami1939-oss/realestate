"use client";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { settingsGroups, settingsItem, visibleItems } from "@/components/app-shell/nav-items";
import { Link, usePathname } from "@/i18n/navigation";
import type { Access } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { SettingsTile } from "./settings-tile";

/**
 * Beside every settings page (like System Settings): the hub's groups on wide screens, a link
 * back to the hub on phones. Nothing on the hub itself, which lists them in full.
 */
export function SettingsNav({ access }: { access: Access }) {
  const t = useTranslations();
  const pathname = usePathname();
  if (pathname === settingsItem.href) return null;
  return (
    <>
      <Link
        href={settingsItem.href}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary lg:hidden"
      >
        <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("settingsHub.back")}
      </Link>
      <nav
        aria-label={t("nav.settings")}
        className="sticky top-20 hidden w-56 shrink-0 space-y-5 self-start lg:block"
      >
        {settingsGroups.map((group) => {
          const items = visibleItems(group.items, access, false);
          if (items.length === 0) return null;
          return (
            <div key={group.id} className="space-y-1">
              <div className="px-2 text-[0.6875rem] font-semibold text-muted-foreground">
                {t(`settingsHub.groups.${group.id}`)}
              </div>
              <ul>
                {items.map((item) => {
                  const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
                          current
                            ? "bg-raised font-medium shadow-card"
                            : "text-foreground/90 hover:bg-muted/60",
                        )}
                      >
                        <SettingsTile item={item} small />
                        <span className="truncate">{t(`nav.${item.key}`)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </>
  );
}
