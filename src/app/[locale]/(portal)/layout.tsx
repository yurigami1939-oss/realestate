import { getTranslations } from "next-intl/server";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { PortalNav, type PortalSection } from "@/components/portal/portal-nav";
import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { AppError } from "@/lib/result";
import { getSession } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/organizations/queries";
import { getPortalCtx } from "@/server/portal/context";
import { getPortalSections } from "@/server/portal/queries";

/**
 * Portal shell of buyers, co-owners and occupants (module 7): one organization at a time,
 * phone-first. Staff are sent back to the back office.
 */
export default async function PortalLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = toLocale((await params).locale);
  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in", locale });
  const ctx = await getPortalCtx().catch((error: unknown) => {
    if (error instanceof AppError) return null;
    throw error;
  });
  if (!ctx) return redirect({ href: "/dashboard", locale });
  const organization = (await listUserOrganizations(session.user.id)).find(
    (o) => o.id === ctx.orgId,
  );
  const t = await getTranslations("portal.shell");
  const has = await getPortalSections(ctx);
  const sections: PortalSection[] = [
    { key: "home", href: "/portal" },
    ...(has.residences
      ? ([
          { key: "announcements", href: "/portal/announcements" },
          { key: "tickets", href: "/portal/tickets" },
        ] as const)
      : []),
    ...(has.coOwner ? ([{ key: "assemblies", href: "/portal/assemblies" }] as const) : []),
    ...(has.payments ? ([{ key: "payments", href: "/portal/payments" }] as const) : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <div>
            <div className="font-semibold">{organization?.name}</div>
            <div className="text-xs text-muted-foreground">{t("title")}</div>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <SignOutButton />
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-2">
          <PortalNav sections={sections} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">{children}</main>
    </div>
  );
}
