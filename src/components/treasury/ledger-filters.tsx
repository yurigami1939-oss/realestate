"use client";

import { useTranslations } from "next-intl";

import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The ledger's period, kept in the URL (`from`, `to`). */
export function LedgerFilters({ from, to }: { from: string; to: string }) {
  const t = useTranslations("treasury.ledger");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="ledger-filters">
      <div className="space-y-1">
        <Label htmlFor="ledger-from">{t("from")}</Label>
        <Input
          id="ledger-from"
          type="date"
          dir="ltr"
          defaultValue={from}
          onChange={(e) => params.set({ from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ledger-to">{t("to")}</Label>
        <Input
          id="ledger-to"
          type="date"
          dir="ltr"
          defaultValue={to}
          onChange={(e) => params.set({ to: e.target.value })}
        />
      </div>
    </div>
  );
}
