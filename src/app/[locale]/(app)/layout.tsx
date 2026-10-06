import { getTranslations } from "next-intl/server";

import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { redirect } from "@/i18n/navigation";
import { localeDirection, toLocale } from "@/i18n/locales";
import { isPortalOnly } from "@/lib/permissions";
import { getSession, getTenantCtx } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/organizations/queries";

/** Back-office shell. Every page below requires a session and an active organization. */
export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = toLocale((await params).locale);
  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in", locale });

  const activeOrgId = session.session.activeOrganizationId;
  const organizations = await listUserOrganizations(session.user.id);
  const active = organizations.find((o) => o.id === activeOrgId);
  if (!activeOrgId || !active) return redirect({ href: "/onboarding", locale });

  const t = await getTranslations("shell");
  const ctx = await getTenantCtx();
  if (isPortalOnly(ctx.roles)) return redirect({ href: "/portal", locale });

  return (
    <SidebarProvider>
      <AppSidebar
        side={localeDirection(locale) === "rtl" ? "right" : "left"}
        organizations={organizations.map(({ id, name }) => ({ id, name }))}
        activeOrgId={activeOrgId}
        user={{ name: session.user.name, email: session.user.email }}
        roles={ctx.roles}
        group={organizations.filter((o) => o.roles.includes("owner")).length > 1}
      />
      {/* min-w-0: wide tables scroll inside their own container, not the page. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ms-1" label={t("toggleSidebar")} />
          <Separator orientation="vertical" className="me-2 data-[orientation=vertical]:h-4" />
          <span className="truncate text-sm font-medium">{active.name}</span>
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
