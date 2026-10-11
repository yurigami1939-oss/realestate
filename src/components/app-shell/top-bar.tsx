"use client";

import { useTranslations } from "next-intl";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePathname } from "@/i18n/navigation";

import { activeNavItem } from "./nav-items";

/**
 * The back office's top bar: translucent over the page as it scrolls, it names the section
 * the page belongs to (the company's name outside the menu's pages); `children` go to its end.
 */
export function TopBar({ fallback, children }: { fallback: string; children?: React.ReactNode }) {
  const t = useTranslations();
  const item = activeNavItem(usePathname());
  return (
    <header className="sticky top-0 z-20 flex h-13 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-xl backdrop-saturate-150 md:px-4">
      <SidebarTrigger label={t("shell.toggleSidebar")} />
      <span className="truncate text-sm font-semibold">
        {item ? t(`nav.${item.key}`) : fallback}
      </span>
      {children ? <div className="ms-auto flex items-center gap-2">{children}</div> : null}
    </header>
  );
}
