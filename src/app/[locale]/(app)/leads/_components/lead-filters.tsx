"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leadSources, leadStages } from "@/lib/crm";

const ALL = "__all__";

export function LeadFilters({ owners }: { owners: { id: string; name: string }[] | null }) {
  const t = useTranslations("crm");
  const params = useSearchParamsState();
  const current = params.get("q");
  const [q, setQ] = useState(current);

  // Search as you type, once the user pauses.
  useEffect(() => {
    if (q === current) return;
    const timer = setTimeout(() => params.set({ q }), 350);
    return () => clearTimeout(timer);
  }, [q, current, params]);

  const select = (
    key: string,
    label: string,
    allLabel: string,
    options: { value: string; label: string }[],
  ) => (
    <Select
      value={params.get(key) || ALL}
      onValueChange={(value) => params.set({ [key]: value === ALL ? null : value })}
    >
      <SelectTrigger className="w-full sm:w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("leads.search")}
          aria-label={t("leads.search")}
          className="ps-8"
        />
      </div>
      {select(
        "stage",
        t("leads.columns.stage"),
        t("leads.allStages"),
        leadStages.map((s) => ({ value: s, label: t(`stage.${s}`) })),
      )}
      {select(
        "source",
        t("leads.columns.source"),
        t("leads.allSources"),
        leadSources.map((s) => ({ value: s, label: t(`source.${s}`) })),
      )}
      {owners
        ? select("assignee", t("leads.columns.assignee"), t("leads.allAssignees"), [
            { value: "none", label: t("leads.unassigned") },
            ...owners.map((o) => ({ value: o.id, label: o.name })),
          ])
        : null}
      <div className="flex items-center gap-2 px-1">
        <Checkbox
          id="duplicates-only"
          checked={params.get("duplicates") === "1"}
          onCheckedChange={(checked) => params.set({ duplicates: checked === true ? "1" : null })}
        />
        <Label htmlFor="duplicates-only" className="font-normal">
          {t("leads.duplicatesOnly")}
        </Label>
      </div>
    </div>
  );
}
