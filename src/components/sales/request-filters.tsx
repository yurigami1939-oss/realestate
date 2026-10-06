"use client";

import { useTranslations } from "next-intl";

import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { portalRequestStatuses } from "@/lib/requests";

/** Portal requests list: the state shown, kept in the URL. */
export function RequestFilters({ status }: { status: string }) {
  const t = useTranslations("requests");
  const params = useSearchParamsState();
  return (
    <div className="space-y-1">
      <Label htmlFor="request-status">{t("filters.status")}</Label>
      <Select value={status} onValueChange={(value) => params.set({ status: value })}>
        <SelectTrigger id="request-status" className="min-w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {portalRequestStatuses.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`status.${s}`)}
            </SelectItem>
          ))}
          <SelectItem value="all">{t("filters.all")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
