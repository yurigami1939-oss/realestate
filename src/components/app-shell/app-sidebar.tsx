"use client";

import {
  Building,
  Building2,
  CalendarDays,
  Contact,
  Kanban,
  LayoutDashboard,
  type LucideIcon,
  PhoneCall,
  Target,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Link, usePathname } from "@/i18n/navigation";

import { NavUser } from "./nav-user";
import { type OrgOption, OrgSwitcher } from "./org-switcher";

type NavKey =
  | "dashboard"
  | "projects"
  | "members"
  | "company"
  | "leads"
  | "pipeline"
  | "followUps"
  | "visits"
  | "targets";
type NavItem = { href: string; key: NavKey; icon: LucideIcon };

/** Each module adds its entries here as it lands (CLAUDE.md §11 Roadmap). */
const mainNav: NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/projects", key: "projects", icon: Building2 },
];
const salesNav: NavItem[] = [
  { href: "/leads", key: "leads", icon: Contact },
  { href: "/leads/pipeline", key: "pipeline", icon: Kanban },
  { href: "/follow-ups", key: "followUps", icon: PhoneCall },
  { href: "/visits", key: "visits", icon: CalendarDays },
  { href: "/targets", key: "targets", icon: Target },
];
const settingsNav: NavItem[] = [
  { href: "/settings/members", key: "members", icon: Users },
  { href: "/settings/company", key: "company", icon: Building },
];

const allItems = [...mainNav, ...salesNav, ...settingsNav];

/** The most specific entry matching the path ("/leads/pipeline" beats "/leads"). */
function activeHref(pathname: string): string | undefined {
  return allItems
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

export function AppSidebar({
  side,
  organizations,
  activeOrgId,
  user,
  access,
}: {
  side: "left" | "right";
  /** Entries shown by role: sales (CRM) for roles that work leads, company for the gérant. */
  access: { sales: boolean; company: boolean };
  organizations: OrgOption[];
  activeOrgId: string;
  user: { name: string; email: string };
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const active = activeHref(pathname);

  const renderGroup = (label: string, items: NavItem[]) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={item.href === active}
                tooltip={t(`nav.${item.key}`)}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{t(`nav.${item.key}`)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar side={side} collapsible="icon" mobileTitle={t("nav.main")}>
      <SidebarHeader>
        <OrgSwitcher organizations={organizations} activeId={activeOrgId} />
      </SidebarHeader>
      <SidebarContent>
        {renderGroup(t("nav.main"), mainNav)}
        {access.sales ? renderGroup(t("nav.sales"), salesNav) : null}
        {renderGroup(
          t("nav.settings"),
          settingsNav.filter((item) => item.key !== "company" || access.company),
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail label={t("shell.toggleSidebar")} />
    </Sidebar>
  );
}
