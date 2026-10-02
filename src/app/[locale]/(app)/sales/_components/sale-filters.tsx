"use client";

import { useTranslations } from "next-intl";

import { SearchInput } from "@/components/data-table/search-input";
import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reservationStatuses } from "@/lib/sales";

const ALL = "__all__";

export function SaleFilters() {
  const t = useTranslations("sales");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput label={t("search")} />
      <Select
        value={params.get("status") || ALL}
        onValueChange={(value) => params.set({ status: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-48" aria-label={t("columns.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
          {reservationStatuses.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`status.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
