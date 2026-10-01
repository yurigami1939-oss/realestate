"use client";

import {
  Building,
  Building2,
  CalendarDays,
  Contact,
  FileSignature,
  IdCard,
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
import { can, type Permission, type Role } from "@/lib/permissions";

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
  | "targets"
  | "buyers"
  | "saleList";
/** `permission`: shown only to roles that have it (display only; services enforce). */
type NavItem = { href: string; key: NavKey; icon: LucideIcon; permission?: Permission };

/** Each module adds its entries here as it lands (CLAUDE.md §11 Roadmap). */
const mainNav: NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/projects", key: "projects", icon: Building2, permission: "inventory:read" },
];
const salesNav: NavItem[] = [
  { href: "/leads", key: "leads", icon: Contact, permission: "lead:read" },
  { href: "/leads/pipeline", key: "pipeline", icon: Kanban, permission: "lead:read" },
  { href: "/follow-ups", key: "followUps", icon: PhoneCall, permission: "lead:read" },
  { href: "/visits", key: "visits", icon: CalendarDays, permission: "lead:read" },
  { href: "/targets", key: "targets", icon: Target, permission: "lead:read" },
];
const contractsNav: NavItem[] = [
  { href: "/sales", key: "saleList", icon: FileSignature, permission: "sale:read" },
  { href: "/buyers", key: "buyers", icon: IdCard, permission: "buyer:read" },
];
const settingsNav: NavItem[] = [
  { href: "/settings/members", key: "members", icon: Users },
  { href: "/settings/company", key: "company", icon: Building, permission: "organization:update" },
];

const allItems = [...mainNav, ...salesNav, ...contractsNav, ...settingsNav];

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
  roles,
}: {
  side: "left" | "right";
  roles: Role[];
  organizations: OrgOption[];
  activeOrgId: string;
  user: { name: string; email: string };
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const active = activeHref(pathname);

  const renderGroup = (label: string, all: NavItem[]) => {
    const items = all.filter((item) => !item.permission || can(roles, item.permission));
    if (items.length === 0) return null;
    return (
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
  };

  return (
    <Sidebar side={side} collapsible="icon" mobileTitle={t("nav.main")}>
      <SidebarHeader>
        <OrgSwitcher organizations={organizations} activeId={activeOrgId} />
      </SidebarHeader>
      <SidebarContent>
        {renderGroup(t("nav.main"), mainNav)}
        {renderGroup(t("nav.sales"), salesNav)}
        {renderGroup(t("nav.contracts"), contractsNav)}
        {renderGroup(t("nav.settings"), settingsNav)}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail label={t("shell.toggleSidebar")} />
    </Sidebar>
  );
}
