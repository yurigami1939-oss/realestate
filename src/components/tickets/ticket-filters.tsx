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
import { ticketStatuses } from "@/lib/tickets";

const ALL = "__all__";

/** Residence and status filters of the tickets list, kept in the URL (active by default). */
export function TicketFilters({ residences }: { residences: { id: string; name: string }[] }) {
  const t = useTranslations("tickets");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={params.get("residence") || ALL}
        onValueChange={(value) => params.set({ residence: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-64" aria-label={t("columns.residence")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allResidences")}</SelectItem>
          {residences.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={params.get("status") || "active"}
        onValueChange={(value) => params.set({ status: value === "active" ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-48" aria-label={t("columns.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">{t("active")}</SelectItem>
          <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
          {ticketStatuses.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`status.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
