"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type PortalSection = {
  key: "home" | "announcements" | "tickets" | "assemblies" | "payments" | "documents";
  href: string;
};

/** Sections of the portal, as tabs (the current one marked). */
export function PortalNav({ sections }: { sections: PortalSection[] }) {
  const t = useTranslations("portal.shell.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto">
      {sections.map((s) => {
        const current = s.href === "/portal" ? pathname === s.href : pathname.startsWith(s.href);
        return (
          <Link
            key={s.key}
            href={s.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              current
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(s.key)}
          </Link>
        );
      })}
    </nav>
  );
}
