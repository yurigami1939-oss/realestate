"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type AttendanceKind,
  attendanceKinds,
  formatSharesPercent,
  votingKinds,
} from "@/lib/assemblies";
import { cn } from "@/lib/utils";
import { saveAttendanceAction } from "@/server/assemblies/actions";
import type { AttendanceRow } from "@/server/assemblies/queries";

const kindClasses: Record<AttendanceKind, string> = {
  present: "bg-emerald-100 text-emerald-900 border-emerald-300",
  represented: "bg-sky-100 text-sky-900 border-sky-300",
  absent: "bg-zinc-100 text-zinc-700 border-zinc-300",
};

type Entry = { kind: AttendanceKind; proxyName: string };

/**
 * Attendance sheet of an assembly: each unit of the residence is present, represented by a
 * proxy or absent (not yet recorded = absent), saved as a whole. Read-only once closed.
 */
export function AttendanceSheet({
  assemblyId,
  sheet,
  editable,
}: {
  assemblyId: string;
  sheet: AttendanceRow[];
  editable: boolean;
}) {
  const t = useTranslations("assemblies.attendance");
  const translate = useTranslateKey();
  const save = useAction(saveAttendanceAction);
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      sheet.map((u) => [u.unitId, { kind: u.kind ?? "absent", proxyName: u.proxyName ?? "" }]),
    ),
  );
  const entryOf = (unitId: string): Entry => entries[unitId] ?? { kind: "absent", proxyName: "" };
  const set = (unitId: string, change: Partial<Entry>) =>
    setEntries((prev) => ({ ...prev, [unitId]: { ...entryOf(unitId), ...change } }));
  const voting = sheet.filter((u) => votingKinds.includes(entryOf(u.unitId).kind));
  const shares = voting.reduce((sum, u) => sum + u.share, 0);
  const total = sheet.reduce((sum, u) => sum + u.share, 0);

  if (sheet.length === 0) return <p className="text-sm text-muted-foreground">{t("noUnits")}</p>;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="attendance-sheet">
          <TableHeader>
            <TableRow>
              <TableHead>{t("unit")}</TableHead>
              <TableHead>{t("coOwner")}</TableHead>
              <TableHead className="text-end">{t("share")}</TableHead>
              <TableHead>{t("kind")}</TableHead>
              <TableHead>{t("proxy")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheet.map((u) => {
              const entry = entryOf(u.unitId);
              return (
                <TableRow key={u.unitId} data-unit={u.code}>
                  <TableCell dir="ltr" className="text-start font-medium">
                    {u.code}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {u.coOwnerName ?? (
                      <span className="text-muted-foreground">{t("promoter")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{u.share}</TableCell>
                  <TableCell>
                    {editable ? (
                      <div
                        role="radiogroup"
                        aria-label={t("kindOf", { code: u.code })}
                        className="inline-flex gap-1"
                      >
                        {attendanceKinds.map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            role="radio"
                            aria-checked={entry.kind === kind}
                            onClick={() => set(u.unitId, { kind })}
                            className={cn(
                              "rounded-md border px-2 py-1 text-xs",
                              entry.kind === kind
                                ? kindClasses[kind]
                                : "border-transparent text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {t(`kinds.${kind}`)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span
                        className={cn(
                          "rounded-md border px-2 py-1 text-xs",
                          u.kind ? kindClasses[u.kind] : "border-dashed text-muted-foreground",
                        )}
                      >
                        {u.kind ? t(`kinds.${u.kind}`) : t("notRecorded")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editable && entry.kind === "represented" ? (
                      <Input
                        value={entry.proxyName}
                        onChange={(e) => set(u.unitId, { proxyName: e.target.value })}
                        className="h-8 w-48"
                        aria-label={t("proxyOf", { code: u.code })}
                      />
                    ) : (
                      <span className="whitespace-normal">
                        {entry.kind === "represented" ? entry.proxyName : ""}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="font-normal" data-testid="attendance-summary">
                {t("summary", {
                  voters: voting.length,
                  units: sheet.length,
                  shares,
                  total,
                  percent: formatSharesPercent(shares, total),
                })}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {editable ? (
        <Button
          disabled={save.pending}
          onClick={() =>
            void save.run(
              {
                assemblyId,
                rows: sheet.map((u) => ({ unitId: u.unitId, ...entryOf(u.unitId) })),
              },
              {
                onSuccess: () => toast.success(t("saved")),
                onError: (error) => {
                  const key = Object.values(error.fieldErrors ?? {})[0]?.[0];
                  toast.error(translate(key ?? error.messageKey));
                  return true;
                },
              },
            )
          }
        >
          {t("save")}
        </Button>
      ) : null}
    </div>
  );
}
