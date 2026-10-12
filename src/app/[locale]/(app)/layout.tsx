import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { CommandPalette } from "@/components/app-shell/command-palette";
import { TopBar } from "@/components/app-shell/top-bar";
import { DemoBanner } from "@/components/demo/demo-banner";
import { SubscriptionBanner } from "@/components/subscription/subscription-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { redirect } from "@/i18n/navigation";
import { localeDirection, toLocale } from "@/i18n/locales";
import { accessOf, can, isPortalOnly } from "@/lib/permissions";
import { OPERATOR_ROLE } from "@/server/auth/schema-options";
import { getSession, getTenantCtx } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/organizations/queries";

/** Back-office shell. Every page below requires a session and an active organization. */
export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = toLocale((await params).locale);
  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in", locale });
  // Operators belong to no organization: their place is the console (CLAUDE.console.md §9).
  if ((session.user as { role?: string | null }).role === OPERATOR_ROLE) {
    return redirect({ href: "/console", locale });
  }

  const activeOrgId = session.session.activeOrganizationId;
  const organizations = await listUserOrganizations(session.user.id);
  const active = organizations.find((o) => o.id === activeOrgId);
  if (!activeOrgId || !active) return redirect({ href: "/onboarding", locale });

  const ctx = await getTenantCtx();
  if (isPortalOnly(ctx.roles)) return redirect({ href: "/portal", locale });

  const access = accessOf(ctx);
  const group = organizations.filter((o) => o.roles.includes("owner")).length > 1;
  return (
    <SidebarProvider>
      <AppSidebar
        side={localeDirection(locale) === "rtl" ? "right" : "left"}
        organizations={organizations.map(({ id, name }) => ({ id, name }))}
        activeOrgId={activeOrgId}
        user={{ name: session.user.name, email: session.user.email }}
        roles={access}
        group={group}
      />
      {/* min-w-0: wide tables scroll inside their own container, not the page. */}
      <SidebarInset className="min-w-0">
        <DemoBanner />
        <SubscriptionBanner access={ctx.access} billing={can(ctx, "subscription:read")} />
        <TopBar fallback={active.name}>
          <CommandPalette access={access} group={group} />
        </TopBar>
        <div className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
