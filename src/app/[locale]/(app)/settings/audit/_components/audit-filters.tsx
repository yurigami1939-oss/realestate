"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { auditEntityTypes } from "@/server/audit/schemas";

const ALL = "__all__";

/** Record type, member and period filters, kept in the URL. */
export function AuditFilters({ actors }: { actors: { userId: string; name: string }[] }) {
  const t = useTranslations("audit");
  const params = useSearchParamsState();
  const entityId = params.get("entityId");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="audit-entity">{t("filters.entityType")}</Label>
        <Select
          value={params.get("entityType") || ALL}
          onValueChange={(value) => params.set({ entityType: value === ALL ? null : value })}
        >
          <SelectTrigger id="audit-entity" className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("filters.allEntities")}</SelectItem>
            {auditEntityTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`entities.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="audit-actor">{t("filters.actor")}</Label>
        <Select
          value={params.get("actorUserId") || ALL}
          onValueChange={(value) => params.set({ actorUserId: value === ALL ? null : value })}
        >
          <SelectTrigger id="audit-actor" className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("filters.allActors")}</SelectItem>
            {actors.map((a) => (
              <SelectItem key={a.userId} value={a.userId}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="audit-from">{t("filters.from")}</Label>
        <Input
          id="audit-from"
          type="date"
          dir="ltr"
          className="w-40"
          value={params.get("from") ?? ""}
          onChange={(e) => params.set({ from: e.target.value || null })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="audit-to">{t("filters.to")}</Label>
        <Input
          id="audit-to"
          type="date"
          dir="ltr"
          className="w-40"
          value={params.get("to") ?? ""}
          onChange={(e) => params.set({ to: e.target.value || null })}
        />
      </div>
      {entityId ? (
        <Button variant="outline" size="sm" onClick={() => params.set({ entityId: null })}>
          <X data-icon="inline-start" />
          {t("filters.oneRecord")}
        </Button>
      ) : null}
    </div>
  );
}
