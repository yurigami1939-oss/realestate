import {
  Bell,
  CalendarDays,
  CreditCard,
  Ellipsis,
  FolderOpen,
  House,
  type LucideIcon,
  Megaphone,
  UserCheck,
  Users,
  Wrench,
} from "lucide-react";

/** Each portal section's icon (tab bar, « Plus », home rows). */
export const portalIcons = {
  home: House,
  documents: FolderOpen,
  payments: CreditCard,
  announcements: Megaphone,
  tickets: Wrench,
  rooms: CalendarDays,
  visitors: UserCheck,
  assemblies: Users,
  notifications: Bell,
  more: Ellipsis,
} satisfies Record<string, LucideIcon>;

export type PortalIconKey = keyof typeof portalIcons;
