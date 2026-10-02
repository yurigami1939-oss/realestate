"use client";

import { Check, ChevronsUpDown, Languages, LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { useSignOut } from "@/components/auth/sign-out-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { locales } from "@/i18n/locales";
import { usePathname, useRouter } from "@/i18n/navigation";

export function NavUser({ user }: { user: { name: string; email: string } }) {
  const t = useTranslations();
  const current = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const { signOut, pending: signingOut } = useSignOut();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" data-testid="user-menu">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="grid flex-1 text-start text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground" dir="ltr">
                  {user.email}
                </span>
              </span>
              <ChevronsUpDown className="ms-auto size-4 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
              <Languages className="size-4" />
              {t("shell.language")}
            </DropdownMenuLabel>
            {locales.map((locale) => (
              <DropdownMenuItem
                key={locale}
                lang={locale}
                disabled={pending}
                onSelect={() => startTransition(() => router.replace(pathname, { locale }))}
              >
                <span className="flex-1">{t(`locale.${locale}`)}</span>
                {locale === current ? <Check className="size-4" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOut} disabled={signingOut}>
              <LogOut className="size-4 rtl:rotate-180" />
              {t("common.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
