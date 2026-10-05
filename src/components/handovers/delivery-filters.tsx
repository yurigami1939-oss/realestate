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
import { deliveryStates } from "@/lib/handovers";

const ALL = "__all__";
const ACTIVE = "active";

/** Project and state filters of the deliveries list, kept in the URL (active ones by default). */
export function DeliveryFilters({ projects }: { projects: { id: string; name: string }[] }) {
  const t = useTranslations("handovers");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={params.get("project") || ALL}
        onValueChange={(value) => params.set({ project: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-64" aria-label={t("allProjects")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allProjects")}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={params.get("state") || ACTIVE}
        onValueChange={(value) => params.set({ state: value === ACTIVE ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-52" aria-label={t("columns.state")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ACTIVE}>{t("activeStates")}</SelectItem>
          <SelectItem value="all">{t("allStates")}</SelectItem>
          {deliveryStates.map((state) => (
            <SelectItem key={state} value={state}>
              {t(`state.${state}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
