"use client";

import { Building2, LayoutDashboard, type LucideIcon, Users } from "lucide-react";
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

type NavKey = "dashboard" | "projects" | "members";
type NavItem = { href: string; key: NavKey; icon: LucideIcon };

/** Each module adds its entries here as it lands (CLAUDE.md §11 Roadmap). */
const mainNav: NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/projects", key: "projects", icon: Building2 },
];
const settingsNav: NavItem[] = [{ href: "/settings/members", key: "members", icon: Users }];

export function AppSidebar({
  side,
  organizations,
  activeOrgId,
  user,
}: {
  side: "left" | "right";
  organizations: OrgOption[];
  activeOrgId: string;
  user: { name: string; email: string };
}) {
  const t = useTranslations();
  const pathname = usePathname();

  const renderGroup = (label: string, items: NavItem[]) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
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
        {renderGroup(t("nav.settings"), settingsNav)}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail label={t("shell.toggleSidebar")} />
    </Sidebar>
  );
}
