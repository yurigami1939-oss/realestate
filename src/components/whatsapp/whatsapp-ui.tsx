"use client";

import { useTranslations } from "next-intl";

import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { whatsappKinds, type WhatsappStatus, whatsappStatuses } from "@/lib/whatsapp";

const badge =
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const statusClasses: Record<WhatsappStatus, string> = {
  queued: "border-amber-300 bg-amber-50 text-amber-900",
  sent: "border-sky-200 bg-sky-50 text-sky-900",
  delivered: "border-emerald-300 bg-emerald-50 text-emerald-900",
  read: "border-emerald-400 bg-emerald-100 text-emerald-950",
  failed: "border-red-300 bg-red-50 text-red-900",
};

export function WhatsappStatusBadge({ status }: { status: WhatsappStatus }) {
  const t = useTranslations("whatsapp.status");
  return <span className={cn(badge, statusClasses[status])}>{t(status)}</span>;
}

const ALL = "__all__";

/** Status and kind of message, kept in the URL. */
export function WhatsappLogFilters() {
  const t = useTranslations("whatsapp");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={params.get("status") || ALL}
        onValueChange={(value) => params.set({ status: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-48" aria-label={t("filters.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.allStatuses")}</SelectItem>
          {whatsappStatuses.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`status.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={params.get("kind") || ALL}
        onValueChange={(value) => params.set({ kind: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-64" aria-label={t("filters.kind")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.allKinds")}</SelectItem>
          {whatsappKinds.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`kind.${k}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
