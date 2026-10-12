import {
  Calculator,
  ChartColumn,
  CreditCard,
  FileUp,
  HardHat,
  Hotel,
  House,
  type LucideIcon,
  MessageCircle,
  Smartphone,
  Wallet,
  Webhook,
} from "lucide-react";

import type { Module } from "@/lib/modules";

/** Each module's icon and its tile (a tone of globals.css), like the settings hub. */
export const moduleIcons: Record<Module, { icon: LucideIcon; tile: string }> = {
  imports: { icon: FileUp, tile: "bg-teal-vivid" },
  construction: { icon: HardHat, tile: "bg-orange-vivid" },
  costs: { icon: Calculator, tile: "bg-indigo-vivid" },
  treasury: { icon: Wallet, tile: "bg-success-vivid" },
  reports: { icon: ChartColumn, tile: "bg-info-vivid" },
  portal: { icon: Smartphone, tile: "bg-purple-vivid" },
  lead_capture: { icon: Webhook, tile: "bg-teal-vivid" },
  syndic: { icon: Hotel, tile: "bg-pink-vivid" },
  rentals: { icon: House, tile: "bg-warning-vivid" },
  whatsapp: { icon: MessageCircle, tile: "bg-success-vivid" },
  online_payment: { icon: CreditCard, tile: "bg-info-vivid" },
};
