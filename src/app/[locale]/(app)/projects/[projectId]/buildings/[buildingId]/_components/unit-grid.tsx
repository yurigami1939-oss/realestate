"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { unitStatusClasses, useFloorLabel } from "@/components/inventory/status";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { type UnitStatus, unitStatuses } from "@/lib/inventory";
import { formatCompactDZD } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { GridUnit } from "@/server/inventory/queries";

/**
 * Availability grid: one row per floor (top first), one tile per unit colored by status.
 * The legend doubles as a status filter.
 */
export function UnitGrid({
  projectId,
  units,
  lowestFloor,
  topFloor,
}: {
  projectId: string;
  units: GridUnit[];
  lowestFloor: number;
  topFloor: number;
}) {
  const t = useTranslations("inventory");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const floorLabel = useFloorLabel();
  const [filter, setFilter] = useState<UnitStatus | null>(null);

  const counts = useMemo(() => {
    const c = Object.fromEntries(unitStatuses.map((s) => [s, 0])) as Record<UnitStatus, number>;
    for (const u of units) c[u.status] += 1;
    return c;
  }, [units]);

  const floors = useMemo(() => {
    const rows: { floor: number; units: GridUnit[] }[] = [];
    for (let floor = topFloor; floor >= lowestFloor; floor -= 1) {
      rows.push({ floor, units: units.filter((u) => u.floor === floor) });
    }
    return rows;
  }, [units, lowestFloor, topFloor]);

  if (units.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        {t("grid.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("grid.legend")}>
        <Button
          size="sm"
          variant={filter === null ? "secondary" : "ghost"}
          onClick={() => setFilter(null)}
        >
          {t("grid.all")} · {units.length}
        </Button>
        {unitStatuses
          .filter((s) => counts[s] > 0)
          .map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={filter === s}
              onClick={() => setFilter(filter === s ? null : s)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-medium transition-opacity",
                unitStatusClasses[s],
                filter && filter !== s ? "opacity-40" : "",
              )}
            >
              {t(`unitStatus.${s}`)} · {counts[s]}
            </button>
          ))}
      </div>

      <div className="overflow-x-auto rounded-lg border" data-testid="unit-grid">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {floors.map(({ floor, units: floorUnits }) => (
              <tr key={floor} className="border-b last:border-b-0">
                <th
                  scope="row"
                  className="w-28 bg-muted/50 px-3 py-2 text-start align-top text-xs font-medium whitespace-nowrap text-muted-foreground"
                >
                  {floorLabel(floor)}
                </th>
                <td className="p-2">
                  <div className="flex flex-wrap gap-2">
                    {floorUnits.map((u) => (
                      <Link
                        key={u.id}
                        href={`/projects/${projectId}/units/${u.id}`}
                        title={`${u.code} · ${t(`unitStatus.${u.status}`)}`}
                        data-status={u.status}
                        className={cn(
                          "flex w-32 flex-col rounded-md border px-2 py-1.5 transition-opacity hover:shadow-sm focus-visible:outline-2",
                          unitStatusClasses[u.status],
                          filter && filter !== u.status ? "opacity-25" : "",
                        )}
                      >
                        <span className="font-semibold" dir="ltr">
                          {u.code}
                        </span>
                        <span className="text-xs">
                          {[
                            u.typology,
                            u.livingArea ? `${u.livingArea.replace(".", ",")} m²` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || t(`unitType.${u.type}`)}
                        </span>
                        <span className="text-xs font-medium" dir="ltr">
                          {u.listPrice !== null
                            ? formatCompactDZD(u.listPrice, locale)
                            : t("units.noPrice")}
                        </span>
                      </Link>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
