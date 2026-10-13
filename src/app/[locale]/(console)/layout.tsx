import { getTranslations } from "next-intl/server";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { BrandMark } from "@/components/brand/brand-mark";
import { ConsoleNav } from "@/components/console/console-nav";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { BRAND_NAME } from "@/lib/brand";
import { requireOperator } from "@/server/console/guard";

/**
 * The operators' console (CLAUDE.console.md §10): its own shell, outside every tenant. Only
 * operators reach it (404 otherwise); pages require two-factor authentication but the security
 * page, where an operator enrols.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const operator = await requireOperator({ enrolling: true });
  const t = await getTranslations("console");
  return (
    <div className="flex min-h-dvh bg-background">
      <aside
        data-sidebar="sidebar"
        className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 bg-sidebar px-3 py-4 text-sidebar-foreground lg:flex"
      >
        <div className="flex items-center gap-2.5 px-2">
          <BrandMark className="size-7" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{BRAND_NAME}</div>
            <div className="text-[0.6875rem] text-muted-foreground">{t("brand")}</div>
          </div>
        </div>
        <ConsoleNav orientation="vertical" />
        <div className="mt-auto space-y-3 px-2">
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium">{operator.name}</div>
            <div className="truncate text-footnote text-muted-foreground" dir="ltr">
              {operator.email}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LocaleSwitcher />
            <SignOutButton />
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 space-y-2 border-b bg-background/80 px-4 py-2 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BrandMark className="size-6" />
              <span className="text-sm font-semibold">{t("brand")}</span>
            </div>
            <SignOutButton />
          </div>
          <ConsoleNav orientation="horizontal" />
        </header>
        <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
