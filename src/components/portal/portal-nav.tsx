"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

import { portalIcons } from "./portal-icons";

export type PortalSection = {
  key:
    | "home"
    | "announcements"
    | "tickets"
    | "rooms"
    | "visitors"
    | "assemblies"
    | "payments"
    | "documents"
    | "notifications";
  href: string;
};

const MORE_HREF = "/portal/more";

function isCurrent(pathname: string, href: string) {
  return href === "/portal" ? pathname === href : pathname.startsWith(href);
}

/** Sections of the portal on wide screens, as a segmented control (the current one raised). */
export function PortalNav({ sections }: { sections: PortalSection[] }) {
  const t = useTranslations("portal.shell.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex gap-0.5 rounded-xl bg-muted p-1">
        {sections.map((s) => {
          const current = isCurrent(pathname, s.href);
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-150",
                current
                  ? "bg-card font-medium text-foreground shadow-card"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(s.key)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * The portal on phones (CLAUDE.md §14 item 17): an iOS tab bar at the bottom — home, the
 * account's three main sections and « Plus », which lists the others.
 */
export function PortalTabBar({ sections }: { sections: PortalSection[] }) {
  const t = useTranslations("portal.shell.nav");
  const pathname = usePathname();
  const main = sections.filter((s) => s.key !== "notifications").slice(0, 4);
  const rest = sections.filter((s) => !main.includes(s));
  const tabs = [
    ...main.map((s) => ({ key: s.key, href: s.href, current: isCurrent(pathname, s.href) })),
    {
      key: "more" as const,
      href: MORE_HREF,
      current: pathname.startsWith(MORE_HREF) || rest.some((s) => isCurrent(pathname, s.href)),
    },
  ];
  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 sm:hidden"
    >
      <ul className="flex">
        {tabs.map((tab) => {
          const Icon = portalIcons[tab.key];
          return (
            <li key={tab.key} className="flex-1">
              <Link
                href={tab.href}
                aria-current={tab.current ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium",
                  tab.current ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-6" strokeWidth={tab.current ? 2.25 : 1.75} aria-hidden />
                <span className="max-w-full truncate px-1">{t(tab.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
