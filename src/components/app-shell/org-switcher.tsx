"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export type OrgOption = { id: string; name: string };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export function OrgSwitcher({
  organizations,
  activeId,
}: {
  organizations: OrgOption[];
  activeId: string;
}) {
  const t = useTranslations("shell");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = organizations.find((o) => o.id === activeId);

  function select(organizationId: string) {
    if (organizationId === activeId) return;
    startTransition(async () => {
      await authClient.organization.setActive({ organizationId });
      router.replace("/dashboard");
      router.refresh();
    });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" disabled={pending} data-testid="org-switcher">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {initials(active?.name ?? "?")}
              </span>
              <span className="flex-1 truncate text-start font-medium">{active?.name}</span>
              <ChevronsUpDown className="ms-auto size-4 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t("organizations")}
            </DropdownMenuLabel>
            {organizations.map((org) => (
              <DropdownMenuItem key={org.id} onSelect={() => select(org.id)}>
                <span className="flex-1 truncate">{org.name}</span>
                {org.id === activeId ? <Check className="size-4" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/onboarding")}>
              <Plus className="size-4" />
              {t("newOrganization")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
