import { getTranslations } from "next-intl/server";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { DemoBanner } from "@/components/demo/demo-banner";
import { SubscriptionBanner } from "@/components/subscription/subscription-banner";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { PortalNav, PortalTabBar } from "@/components/portal/portal-nav";
import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { moduleOn } from "@/lib/modules";
import { AppError } from "@/lib/result";
import { OPERATOR_ROLE } from "@/server/auth/schema-options";
import { getSession } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/organizations/queries";
import { getPortalCtx } from "@/server/portal/context";
import { portalNavSections } from "@/server/portal/sections";

/**
 * Portal shell of buyers, co-owners and occupants (module 7): one organization at a time,
 * phone first (CLAUDE.md §14 item 17) — a translucent header with the company's name, the
 * sections as a segmented control on wide screens and an iOS tab bar on phones (language and
 * sign-out then live under « Plus »). Staff are sent back to the back office.
 */
export default async function PortalLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = toLocale((await params).locale);
  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in", locale });
  if ((session.user as { role?: string | null }).role === OPERATOR_ROLE) {
    return redirect({ href: "/console", locale });
  }
  const ctx = await getPortalCtx().catch((error: unknown) => {
    if (error instanceof AppError) return null;
    throw error;
  });
  if (!ctx) return redirect({ href: "/dashboard", locale });
  const organization = (await listUserOrganizations(session.user.id)).find(
    (o) => o.id === ctx.orgId,
  );
  const t = await getTranslations("portal.shell");
  // Without the portal module (CLAUDE.console.md §5) the links stay, the space is closed.
  const open = moduleOn(ctx.access?.modules, "portal");
  const sections = open ? await portalNavSections(ctx) : [];

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <DemoBanner />
      <SubscriptionBanner access={ctx.access} billing={false} portal />
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-13 max-w-5xl items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{organization?.name}</div>
            <div className="text-[0.6875rem] text-muted-foreground">{t("title")}</div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <LocaleSwitcher />
            <SignOutButton />
          </div>
        </div>
      </header>
      {open ? (
        <>
          <div className="mx-auto hidden w-full max-w-5xl px-4 pt-4 sm:block">
            <PortalNav sections={sections} />
          </div>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-24 sm:pt-6 sm:pb-10">
            {children}
          </main>
          <PortalTabBar sections={sections} />
        </>
      ) : (
        <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 pt-10 pb-10">
          <p className="empty-state" data-testid="portal-unavailable">
            {t("unavailable", { company: organization?.name ?? "" })}
          </p>
          <div className="flex justify-center sm:hidden">
            <SignOutButton />
          </div>
        </main>
      )}
    </div>
  );
}
