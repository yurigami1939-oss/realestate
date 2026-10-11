import {
  AlarmClock,
  BadgePercent,
  Bell,
  Building,
  Building2,
  CalendarDays,
  ChartColumn,
  Contact,
  CreditCard,
  FileLock2,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FileUp,
  Handshake,
  HardHat,
  Hotel,
  House,
  IdCard,
  Inbox,
  Kanban,
  KeyRound,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  MessageCircle,
  MessageSquareText,
  Network,
  Percent,
  PhoneCall,
  ScrollText,
  Settings,
  ShieldCheck,
  Target,
  Truck,
  UserCog,
  Users,
  Wallet,
  Webhook,
  Wrench,
} from "lucide-react";

import { type Access, can, type Permission } from "@/lib/permissions";

/**
 * The back office's pages, shared by the sidebar, the top bar, the command palette and the
 * settings hub. Each module adds its entries here as it lands (CLAUDE.md §11 Roadmap).
 * `permission`: shown only to roles that have it, or one of them (display only; services
 * enforce).
 */
export type NavKey =
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
  | "discounts"
  | "requests"
  | "leadCapture"
  | "partners"
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
  | "smsLog"
  | "smsSettings"
  | "privacy"
  | "customRoles"
  | "documentTexts"
  | "exports"
  | "imports"
  | "treasury"
  | "reports"
  | "group"
  | "security"
  | "notifications"
  | "settings";

export type NavItem = {
  href: string;
  key: NavKey;
  icon: LucideIcon;
  permission?: Permission | Permission[];
  /** Shown only to a gérant of several companies. */
  groupOnly?: boolean;
  /** Its icon's tile in the settings hub (a tone of globals.css). */
  tile?: string;
};

/** A group of the sidebar, labelled by a `nav.*` key (the first group has none). */
export type NavSection = {
  id: string;
  label?:
    | "promotionGroup"
    | "sales"
    | "contracts"
    | "financeGroup"
    | "rentalsGroup"
    | "residenceGroup"
    | "communicationGroup";
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    id: "home",
    items: [
      { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
      { href: "/group", key: "group", icon: Network, groupOnly: true },
    ],
  },
  {
    id: "promotion",
    label: "promotionGroup",
    items: [
      { href: "/projects", key: "projects", icon: Building2, permission: "inventory:read" },
      {
        href: "/construction",
        key: "construction",
        icon: HardHat,
        permission: "construction:read",
      },
      { href: "/deliveries", key: "deliveries", icon: KeyRound, permission: "handover:read" },
    ],
  },
  {
    id: "prospection",
    label: "sales",
    items: [
      { href: "/leads", key: "leads", icon: Contact, permission: "lead:read" },
      { href: "/leads/pipeline", key: "pipeline", icon: Kanban, permission: "lead:read" },
      { href: "/follow-ups", key: "followUps", icon: PhoneCall, permission: "lead:read" },
      { href: "/visits", key: "visits", icon: CalendarDays, permission: "lead:read" },
      { href: "/targets", key: "targets", icon: Target, permission: "lead:read" },
      {
        href: "/partners",
        key: "partners",
        icon: Handshake,
        permission: ["lead:assign", "commission:read_all"],
      },
    ],
  },
  {
    id: "contracts",
    label: "contracts",
    items: [
      { href: "/sales", key: "saleList", icon: FileSignature, permission: "sale:read" },
      { href: "/sales/overdue", key: "overdue", icon: AlarmClock, permission: "sale:read" },
      { href: "/sales/requests", key: "requests", icon: Inbox, permission: "sale:read" },
      {
        href: "/sales/discounts",
        key: "discounts",
        icon: BadgePercent,
        permission: "discount:decide",
      },
      { href: "/buyers", key: "buyers", icon: IdCard, permission: "buyer:read" },
      { href: "/commissions", key: "commissions", icon: Percent, permission: "commission:read" },
    ],
  },
  {
    id: "finance",
    label: "financeGroup",
    items: [
      { href: "/treasury", key: "treasury", icon: Wallet, permission: "treasury:read" },
      {
        href: "/online-payments",
        key: "onlinePayments",
        icon: CreditCard,
        permission: "payment:read",
      },
      { href: "/reports", key: "reports", icon: ChartColumn, permission: "report:read" },
    ],
  },
  {
    id: "rentals",
    label: "rentalsGroup",
    items: [
      { href: "/rentals", key: "rentals", icon: House, permission: "lease:read" },
      { href: "/rentals/overdue", key: "rentsOverdue", icon: AlarmClock, permission: "lease:read" },
    ],
  },
  {
    id: "residences",
    label: "residenceGroup",
    items: [
      { href: "/residences", key: "residences", icon: Hotel, permission: "residence:read" },
      {
        href: "/residences/overdue",
        key: "chargesOverdue",
        icon: AlarmClock,
        permission: "charge:read",
      },
      { href: "/suppliers", key: "suppliers", icon: Truck, permission: "supplier:read" },
      { href: "/tickets", key: "tickets", icon: Wrench, permission: "ticket:read" },
    ],
  },
  {
    id: "communication",
    label: "communicationGroup",
    items: [
      {
        href: "/whatsapp",
        key: "whatsappLog",
        icon: MessageCircle,
        permission: "notification:read",
      },
      { href: "/sms", key: "smsLog", icon: MessageSquareText, permission: "notification:read" },
    ],
  },
];

/** The sidebar's one entry for the settings hub (`/settings`). */
export const settingsItem: NavItem = { href: "/settings", key: "settings", icon: Settings };

/** A group of the settings hub, labelled by a `settingsHub.groups.*` key. */
export type SettingsGroup = {
  id: "account" | "company" | "channels" | "data";
  items: NavItem[];
};

/**
 * The settings hub's pages (like System Settings: one entry in the sidebar, the pages grouped
 * on `/settings` and beside every settings page).
 */
export const settingsGroups: SettingsGroup[] = [
  {
    id: "account",
    items: [
      { href: "/settings/security", key: "security", icon: ShieldCheck, tile: "bg-gray-vivid" },
      {
        href: "/settings/notifications",
        key: "notifications",
        icon: Bell,
        tile: "bg-danger-vivid",
      },
    ],
  },
  {
    id: "company",
    items: [
      {
        href: "/settings/company",
        key: "company",
        icon: Building,
        permission: "organization:update",
        tile: "bg-info-vivid",
      },
      { href: "/settings/members", key: "members", icon: Users, tile: "bg-indigo-vivid" },
      {
        href: "/settings/roles",
        key: "customRoles",
        icon: UserCog,
        permission: "member:update",
        tile: "bg-purple-vivid",
      },
      {
        href: "/settings/documents",
        key: "documentTexts",
        icon: FileText,
        permission: "organization:update",
        tile: "bg-orange-vivid",
      },
    ],
  },
  {
    id: "channels",
    items: [
      {
        href: "/settings/online-payment",
        key: "paymentGateway",
        icon: Landmark,
        permission: "organization:update",
        tile: "bg-success-vivid",
      },
      {
        href: "/settings/lead-capture",
        key: "leadCapture",
        icon: Webhook,
        permission: "lead:assign",
        tile: "bg-teal-vivid",
      },
      {
        href: "/settings/whatsapp",
        key: "whatsappSettings",
        icon: MessageCircle,
        permission: "organization:update",
        tile: "bg-success-vivid",
      },
      {
        href: "/settings/sms",
        key: "smsSettings",
        icon: MessageSquareText,
        permission: "organization:update",
        tile: "bg-info-vivid",
      },
    ],
  },
  {
    id: "data",
    items: [
      { href: "/exports", key: "exports", icon: FileSpreadsheet, tile: "bg-success-vivid" },
      {
        href: "/imports",
        key: "imports",
        icon: FileUp,
        permission: ["unit:create", "buyer:create", "residence:update", "lead:create"],
        tile: "bg-teal-vivid",
      },
      {
        href: "/settings/privacy",
        key: "privacy",
        icon: FileLock2,
        permission: "organization:update",
        tile: "bg-gray-vivid",
      },
      {
        href: "/settings/audit",
        key: "audit",
        icon: ScrollText,
        permission: "audit:read",
        tile: "bg-gray-vivid",
      },
    ],
  },
];

export const settingsItems: NavItem[] = settingsGroups.flatMap((g) => g.items);

export const allNavItems: NavItem[] = [
  ...navSections.flatMap((s) => s.items),
  ...settingsItems,
  settingsItem,
];

/** The items a member may open (`group`: they run several companies). */
export function visibleItems(items: NavItem[], access: Access, group: boolean): NavItem[] {
  return items.filter(
    (item) =>
      (!item.groupOnly || group) &&
      (!item.permission || [item.permission].flat().some((p) => can(access, p))),
  );
}

/** The most specific entry matching the path ("/leads/pipeline" beats "/leads"). */
export function activeNavItem(pathname: string): NavItem | undefined {
  return allNavItems
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
