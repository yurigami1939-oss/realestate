"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

export const themes = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
] as const;

/** True once in the browser: the chosen theme is only known there (next-themes). */
export function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Light, dark or automatic (the system's), as a small segmented control (CLAUDE.md §14
 * item 18); the back office's user menu offers the same choice.
 */
export function ThemeSwitcher() {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {themes.map(({ value, icon: Icon }) => {
        const active = mounted && (theme ?? "system") === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] transition-colors",
              active
                ? "bg-raised font-medium text-foreground shadow-card"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(value)}
          </button>
        );
      })}
    </div>
  );
}
