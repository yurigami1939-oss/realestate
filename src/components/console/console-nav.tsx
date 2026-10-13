"use client";

import {
  Building2,
  LayoutDashboard,
  type LucideIcon,
  MailPlus,
  Package,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const items: {
  href: string;
  key: "overview" | "accounts" | "provisions" | "plans" | "security";
  icon: LucideIcon;
}[] = [
  { href: "/console", key: "overview", icon: LayoutDashboard },
  { href: "/console/accounts", key: "accounts", icon: Building2 },
  { href: "/console/provisions", key: "provisions", icon: MailPlus },
  { href: "/console/plans", key: "plans", icon: Package },
  { href: "/console/security", key: "security", icon: ShieldCheck },
];

/** The console's pages: a sidebar on wide screens, a scrolling row on phones. */
export function ConsoleNav({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const t = useTranslations("console.nav");
  const pathname = usePathname();
  const current = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav
      aria-label={t("label")}
      className={cn(
        orientation === "vertical" ? "space-y-0.5" : "-mx-1 flex gap-1 overflow-x-auto px-1",
      )}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.href === current ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors pointer-coarse:py-2.5",
            item.href === current
              ? "bg-raised font-medium text-primary shadow-card"
              : "text-foreground/90 hover:bg-muted/60",
          )}
        >
          <item.icon className="size-4" aria-hidden />
          {t(item.key)}
        </Link>
      ))}
    </nav>
  );
}
