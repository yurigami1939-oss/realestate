"use client";

import { useTranslations } from "next-intl";

import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

/** The reports' period and project, kept in the URL. */
export function ReportFilters({
  from,
  to,
  project,
  projects,
}: {
  from: string;
  to: string;
  project: string | null;
  projects: { id: string; name: string }[];
}) {
  const t = useTranslations("reports.filters");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="report-filters">
      <div className="space-y-1">
        <Label htmlFor="report-from">{t("from")}</Label>
        <Input
          id="report-from"
          type="date"
          dir="ltr"
          defaultValue={from}
          onChange={(e) => params.set({ from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="report-to">{t("to")}</Label>
        <Input
          id="report-to"
          type="date"
          dir="ltr"
          defaultValue={to}
          onChange={(e) => params.set({ to: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="report-project">{t("project")}</Label>
        <Select
          value={project ?? ALL}
          onValueChange={(value) => params.set({ project: value === ALL ? null : value })}
        >
          <SelectTrigger id="report-project" className="min-w-48">
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
      </div>
    </div>
  );
}
