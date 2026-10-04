"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { type AttendanceStatus, attendanceStatuses } from "@/lib/residences";
import { cn } from "@/lib/utils";
import { saveAttendanceAction } from "@/server/staff/actions";
import type { AttendanceMonth } from "@/server/staff/attendance";

const cycle: (AttendanceStatus | null)[] = [null, ...attendanceStatuses];

const statusClasses: Record<AttendanceStatus, string> = {
  absent: "bg-red-100 text-red-900",
  leave: "bg-sky-100 text-sky-900",
  sick: "bg-amber-100 text-amber-900",
  off: "bg-zinc-200 text-zinc-700",
};

/**
 * Monthly attendance of a residence's agents: one cell per day, clicked to cycle through the
 * marks; an unmarked day is worked. Saved as a whole.
 */
export function AttendanceGrid({
  residenceId,
  sheet,
  editable,
}: {
  residenceId: string;
  sheet: AttendanceMonth;
  editable: boolean;
}) {
  const t = useTranslations("staff.attendance");
  const locale = useLocale();
  const save = useAction(saveAttendanceAction);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>(() =>
    Object.fromEntries(sheet.marks.map((m) => [`${m.staffId}:${m.day}`, m.status])),
  );
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const days = sheet.days.map((day) => {
    const date = new Date(`${day}T00:00:00Z`);
    // Friday and Saturday: the Algerian weekend.
    return { day, weekday: weekday.format(date), weekend: [5, 6].includes(date.getUTCDay()) };
  });
  const employed = (agent: AttendanceMonth["staff"][number], day: string) =>
    day >= agent.hiredOn && (agent.leftOn === null || day <= agent.leftOn);
  const toggle = (staffId: string, day: string) =>
    setMarks((prev) => {
      const key = `${staffId}:${day}`;
      const next = cycle[(cycle.indexOf(prev[key] ?? null) + 1) % cycle.length] ?? null;
      const copy = { ...prev };
      if (next === null) delete copy[key];
      else copy[key] = next;
      return copy;
    });

  if (sheet.staff.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("legend")}</p>
      <div className="flex flex-wrap gap-2 text-xs">
        {attendanceStatuses.map((status) => (
          <span key={status} className={cn("rounded px-2 py-0.5", statusClasses[status])}>
            {t(`short.${status}`)} · {t(`status.${status}`)}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs" data-testid="attendance">
          <thead>
            <tr>
              <th className="sticky start-0 bg-background p-2 text-start font-medium">
                {t("columns.agent")}
              </th>
              {days.map((d) => (
                <th
                  key={d.day}
                  className={cn("min-w-7 p-1 text-center font-normal", d.weekend && "bg-muted")}
                >
                  <div className="text-muted-foreground">{d.weekday}</div>
                  <div className="tabular-nums">{Number(d.day.slice(8))}</div>
                </th>
              ))}
              {(["worked", ...attendanceStatuses] as const).map((key) => (
                <th key={key} className="p-2 text-end font-medium whitespace-nowrap">
                  {t(`columns.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.staff.map((agent) => {
              const counts = { worked: 0, absent: 0, leave: 0, sick: 0, off: 0 };
              for (const d of days) {
                if (!employed(agent, d.day)) continue;
                counts[marks[`${agent.id}:${d.day}`] ?? "worked"] += 1;
              }
              return (
                <tr key={agent.id} className="border-t">
                  <td className="sticky start-0 bg-background p-2 font-medium whitespace-nowrap">
                    {agent.lastName} {agent.firstName}
                  </td>
                  {days.map((d) => {
                    const status = marks[`${agent.id}:${d.day}`];
                    const working = employed(agent, d.day);
                    return (
                      <td
                        key={d.day}
                        className={cn("p-0.5 text-center", d.weekend && "bg-muted/60")}
                      >
                        <button
                          type="button"
                          disabled={!editable || !working}
                          onClick={() => toggle(agent.id, d.day)}
                          aria-label={t("dayLabel", {
                            agent: `${agent.lastName} ${agent.firstName}`,
                            date: formatDate(d.day),
                            status: t(`status.${status ?? "present"}`),
                          })}
                          className={cn(
                            "size-6 rounded text-xs disabled:cursor-default",
                            !working && "opacity-30",
                            status ? statusClasses[status] : "hover:bg-muted",
                          )}
                        >
                          {working ? (status ? t(`short.${status}`) : "·") : ""}
                        </button>
                      </td>
                    );
                  })}
                  {(["worked", ...attendanceStatuses] as const).map((key) => (
                    <td key={key} className="p-2 text-end tabular-nums">
                      {counts[key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable ? (
        <Button
          disabled={save.pending}
          onClick={() =>
            void save.run(
              {
                residenceId,
                month: sheet.month.slice(0, 7),
                marks: Object.entries(marks).map(([key, status]) => {
                  const [staffId = "", day = ""] = key.split(":");
                  return { staffId, day, status };
                }),
              },
              { onSuccess: () => toast.success(t("saved")) },
            )
          }
        >
          {t("save")}
        </Button>
      ) : null}
    </div>
  );
}
