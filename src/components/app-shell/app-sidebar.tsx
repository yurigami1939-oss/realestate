"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

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
  useSidebar,
} from "@/components/ui/sidebar";
import { Link, usePathname } from "@/i18n/navigation";
import type { Access } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { activeNavItem, navSections, visibleItems } from "./nav-items";
import { NavUser } from "./nav-user";
import { type OrgOption, OrgSwitcher } from "./org-switcher";

/** Folded sidebar groups, remembered in this browser (a convenience: nothing else depends on it). */
const FOLDED_KEY = "sidebar.folded";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readFolded(): string {
  try {
    return window.localStorage.getItem(FOLDED_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeFolded(ids: string[]) {
  try {
    window.localStorage.setItem(FOLDED_KEY, ids.join(","));
  } catch {
    // Storage blocked (private window): groups simply open again next time.
  }
  for (const listener of listeners) listener();
}

export function AppSidebar({
  side,
  organizations,
  activeOrgId,
  user,
  roles,
  group = false,
}: {
  side: "left" | "right";
  roles: Access;
  /** The member runs several companies: the consolidated view is offered. */
  group?: boolean;
  organizations: OrgOption[];
  activeOrgId: string;
  user: { name: string; email: string };
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const active = activeNavItem(pathname)?.href;
  const { state } = useSidebar();
  const stored = useSyncExternalStore(subscribe, readFolded, () => "");
  const folded = stored ? stored.split(",") : [];

  return (
    <Sidebar side={side} collapsible="icon" mobileTitle={t("nav.main")}>
      <SidebarHeader>
        <OrgSwitcher organizations={organizations} activeId={activeOrgId} />
      </SidebarHeader>
      <SidebarContent>
        {navSections.map((section) => {
          const items = visibleItems(section.items, roles, group);
          if (items.length === 0) return null;
          // The group of the current page and every group of the icon rail stay open.
          const open =
            !folded.includes(section.id) ||
            items.some((item) => item.href === active) ||
            state === "collapsed";
          return (
            <SidebarGroup key={section.id} className="py-1">
              {section.label ? (
                <SidebarGroupLabel asChild>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      writeFolded(
                        open ? [...folded, section.id] : folded.filter((id) => id !== section.id),
                      )
                    }
                    className="w-full justify-between hover:text-foreground"
                  >
                    {t(`nav.${section.label}`)}
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        "transition-transform duration-200",
                        open ? "rotate-90" : "rtl:rotate-180",
                      )}
                    />
                  </button>
                </SidebarGroupLabel>
              ) : null}
              {open ? (
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
                            <item.icon className="text-primary" />
                            <span>{t(`nav.${item.key}`)}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              ) : null}
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail label={t("shell.toggleSidebar")} />
    </Sidebar>
  );
}
