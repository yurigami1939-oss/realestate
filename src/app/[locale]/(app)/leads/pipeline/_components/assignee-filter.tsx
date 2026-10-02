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

const ALL = "__all__";

/** Managers: show one commercial's leads, or everyone's. */
export function AssigneeFilter({ owners }: { owners: { id: string; name: string }[] }) {
  const t = useTranslations("crm.leads");
  const params = useSearchParamsState();
  return (
    <Select
      value={params.get("assignee") || ALL}
      onValueChange={(value) => params.set({ assignee: value === ALL ? null : value })}
    >
      <SelectTrigger className="w-56" aria-label={t("columns.assignee")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("allAssignees")}</SelectItem>
        {owners.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
