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
import { discountRequestStates } from "@/lib/discounts";

/** Managers' list of discount requests: the state shown, kept in the URL. */
export function DiscountFilters({ state }: { state: string }) {
  const t = useTranslations("discounts");
  const params = useSearchParamsState();
  return (
    <div className="space-y-1" data-testid="discount-filters">
      <Label htmlFor="discount-state">{t("filters.state")}</Label>
      <Select value={state} onValueChange={(value) => params.set({ state: value })}>
        <SelectTrigger id="discount-state" className="min-w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {discountRequestStates.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`state.${s}`)}
            </SelectItem>
          ))}
          <SelectItem value="all">{t("filters.all")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
