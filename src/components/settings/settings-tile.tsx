import type { NavItem } from "@/components/app-shell/nav-items";
import { cn } from "@/lib/utils";

/** A settings page's icon on its colored rounded tile (as in iOS Settings). */
export function SettingsTile({ item, small = false }: { item: NavItem; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center text-white",
        small ? "size-6 rounded-[0.375rem]" : "size-8 rounded-[0.5rem]",
        item.tile ?? "bg-gray-vivid",
      )}
    >
      <item.icon className={small ? "size-3.5" : "size-4.5"} />
    </span>
  );
}
