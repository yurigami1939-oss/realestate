"use client";

import {
  AlarmClock,
  Building,
  Building2,
  CalendarDays,
  Contact,
  CreditCard,
  FileSignature,
  FileSpreadsheet,
  FileUp,
  HardHat,
  Hotel,
  House,
  IdCard,
  Kanban,
  KeyRound,
  Landmark,
  LayoutDashboard,
  MessageCircle,
  Percent,
  PhoneCall,
  ScrollText,
  Target,
  Truck,
  type LucideIcon,
  Users,
  Wrench,
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
  | "saleList"
  | "overdue"
  | "commissions"
  | "audit"
  | "residences"
  | "chargesOverdue"
  | "suppliers"
  | "tickets"
  | "construction"
  | "deliveries"
  | "rentals"
  | "rentsOverdue"
  | "onlinePayments"
  | "paymentGateway"
  | "whatsappLog"
  | "whatsappSettings"
  | "exports"
  | "imports";
/**
 * `permission`: shown only to roles that have it, or one of them (display only; services
 * enforce).
 */
type NavItem = {
  href: string;
  key: NavKey;
  icon: LucideIcon;
  permission?: Permission | Permission[];
};

/** Each module adds its entries here as it lands (CLAUDE.md §11 Roadmap). */
const mainNav: NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/projects", key: "projects", icon: Building2, permission: "inventory:read" },
  {
    href: "/online-payments",
    key: "onlinePayments",
    icon: CreditCard,
    permission: "payment:read",
  },
  {
    href: "/whatsapp",
    key: "whatsappLog",
    icon: MessageCircle,
    permission: "notification:read",
  },
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
  { href: "/sales/overdue", key: "overdue", icon: AlarmClock, permission: "sale:read" },
  { href: "/buyers", key: "buyers", icon: IdCard, permission: "buyer:read" },
  { href: "/commissions", key: "commissions", icon: Percent, permission: "commission:read" },
];
const constructionNav: NavItem[] = [
  { href: "/construction", key: "construction", icon: HardHat, permission: "construction:read" },
  { href: "/deliveries", key: "deliveries", icon: KeyRound, permission: "handover:read" },
];
const rentalsNav: NavItem[] = [
  { href: "/rentals", key: "rentals", icon: House, permission: "lease:read" },
  { href: "/rentals/overdue", key: "rentsOverdue", icon: AlarmClock, permission: "lease:read" },
];
const residenceNav: NavItem[] = [
  { href: "/residences", key: "residences", icon: Hotel, permission: "residence:read" },
  {
    href: "/residences/overdue",
    key: "chargesOverdue",
    icon: AlarmClock,
    permission: "charge:read",
  },
  { href: "/suppliers", key: "suppliers", icon: Truck, permission: "supplier:read" },
  { href: "/tickets", key: "tickets", icon: Wrench, permission: "ticket:read" },
];
const settingsNav: NavItem[] = [
  { href: "/settings/members", key: "members", icon: Users },
  { href: "/settings/company", key: "company", icon: Building, permission: "organization:update" },
  {
    href: "/settings/online-payment",
    key: "paymentGateway",
    icon: Landmark,
    permission: "organization:update",
  },
  {
    href: "/settings/whatsapp",
    key: "whatsappSettings",
    icon: MessageCircle,
    permission: "organization:update",
  },
  { href: "/exports", key: "exports", icon: FileSpreadsheet },
  {
    href: "/imports",
    key: "imports",
    icon: FileUp,
    permission: ["unit:create", "buyer:create", "residence:update"],
  },
  { href: "/settings/audit", key: "audit", icon: ScrollText, permission: "audit:read" },
];

const allItems = [
  ...mainNav,
  ...salesNav,
  ...contractsNav,
  ...constructionNav,
  ...rentalsNav,
  ...residenceNav,
  ...settingsNav,
];

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
    const items = all.filter(
      (item) => !item.permission || [item.permission].flat().some((p) => can(roles, p)),
    );
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
        {renderGroup(t("nav.constructionGroup"), constructionNav)}
        {renderGroup(t("nav.rentalsGroup"), rentalsNav)}
        {renderGroup(t("nav.residenceGroup"), residenceNav)}
        {renderGroup(t("nav.settings"), settingsNav)}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail label={t("shell.toggleSidebar")} />
    </Sidebar>
  );
}
