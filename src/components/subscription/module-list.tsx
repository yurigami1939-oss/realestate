"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { Switch } from "@/components/ui/switch";
import type { Module } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { setModuleEnabledAction } from "@/server/entitlements/actions";

import { moduleIcons } from "./module-icons";

export type ModuleListRow = {
  module: Module;
  source: "plan" | "addon" | null;
  on: boolean;
  disabled: boolean;
  needs: Module[];
};

/**
 * The organization's modules as an inset grouped list (CLAUDE.console.md §11): each with its
 * switch when the subscription includes it — the gérant turns off what the company does not use
 * (nothing is deleted) — or « Non inclus ».
 */
export function ModuleList({ rows, canSwitch }: { rows: ModuleListRow[]; canSwitch: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const { run, pending } = useAction(setModuleEnabledAction);
  const [busy, setBusy] = useState<Module | null>(null);
  const name = (m: Module) => t(`modules.${m}.name`);

  function toggle(module: Module, on: boolean) {
    setBusy(module);
    void run(
      { module, on },
      {
        onSuccess: () => {
          toast.success(t(on ? "subscription.modules.turnedOn" : "subscription.modules.turnedOff"));
          router.refresh();
        },
        onError: (error) => {
          const key = error.messageKey as Parameters<typeof t>[0];
          const details = error.details ?? {};
          const values: Record<string, string | number> = {};
          if (typeof details.count === "number") values.count = details.count;
          if (typeof details.module === "string") values.module = name(details.module as Module);
          toast.error(t.has(key) ? t(key, values) : t("errors.UNEXPECTED"));
          return true;
        },
      },
    ).finally(() => setBusy(null));
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-card" data-testid="modules">
      {rows.map((row) => {
        const { icon: Icon, tile } = moduleIcons[row.module];
        const blockedBy = row.needs.find((m) => !rows.find((r) => r.module === m)?.on);
        return (
          <li
            key={row.module}
            data-module={row.module}
            data-on={row.on}
            className="flex items-center gap-3 px-4 py-3"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-[0.5rem] text-white",
                row.source ? tile : "bg-gray-vivid opacity-60",
              )}
            >
              <Icon className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-medium", !row.source && "text-muted-foreground")}>
                {name(row.module)}
              </div>
              <div className="text-footnote text-muted-foreground">
                {row.source && blockedBy
                  ? t("subscription.modules.needs", { module: name(blockedBy) })
                  : t(`modules.${row.module}.description`)}
              </div>
            </div>
            {row.source ? (
              <Switch
                checked={row.on}
                disabled={!canSwitch || pending || busy !== null || (!row.on && !!blockedBy)}
                onCheckedChange={(on) => toggle(row.module, on)}
                aria-label={name(row.module)}
              />
            ) : (
              <span className="shrink-0 text-footnote text-muted-foreground">
                {t("subscription.modules.notIncluded")}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
