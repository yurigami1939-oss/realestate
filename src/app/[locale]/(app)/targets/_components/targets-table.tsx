"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { saveTargetsAction } from "@/server/crm/actions";
import type { TargetProgress } from "@/server/crm/targets";

function Progress({ actual, target }: { actual: number; target: number }) {
  const t = useTranslations("targets");
  const ratio = target > 0 ? Math.min(1, actual / target) : 0;
  return (
    <div className="min-w-32 space-y-1">
      <p className="text-sm tabular-nums">
        {target > 0 ? t("progress", { actual, target }) : t("noTarget", { actual })}
      </p>
      {target > 0 ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={cn("h-full", ratio >= 1 ? "bg-emerald-500" : "bg-sky-500")}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Progress per commercial; managers edit the targets inline. */
export function TargetsTable({
  month,
  rows,
  editable,
}: {
  month: string;
  rows: TargetProgress[];
  editable: boolean;
}) {
  const t = useTranslations("targets");
  const save = useAction(saveTargetsAction);
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.userId,
        { visits: String(r.target.visits), quotations: String(r.target.quotations) },
      ]),
    ),
  );
  const edit = (userId: string, key: "visits" | "quotations", value: string) =>
    setValues((prev) => ({
      ...prev,
      [userId]: { visits: "0", quotations: "0", ...prev[userId], [key]: value },
    }));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="targets">
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.member")}</TableHead>
              <TableHead>{t("columns.visits")}</TableHead>
              {editable ? <TableHead className="w-28">{t("target")}</TableHead> : null}
              <TableHead>{t("columns.quotations")}</TableHead>
              {editable ? <TableHead className="w-28">{t("target")}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.userId}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>
                  <Progress actual={r.actual.visits} target={r.target.visits} />
                </TableCell>
                {editable ? (
                  <TableCell>
                    <Input
                      value={values[r.userId]?.visits ?? ""}
                      onChange={(e) => edit(r.userId, "visits", e.target.value)}
                      aria-label={`${t("columns.visits")} ${r.name}`}
                      inputMode="numeric"
                      dir="ltr"
                      className="h-8"
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <Progress actual={r.actual.quotations} target={r.target.quotations} />
                </TableCell>
                {editable ? (
                  <TableCell>
                    <Input
                      value={values[r.userId]?.quotations ?? ""}
                      onChange={(e) => edit(r.userId, "quotations", e.target.value)}
                      aria-label={`${t("columns.quotations")} ${r.name}`}
                      inputMode="numeric"
                      dir="ltr"
                      className="h-8"
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editable ? (
        <Button
          disabled={save.pending}
          onClick={() =>
            void save.run(
              {
                month,
                targets: rows.map((r) => ({
                  userId: r.userId,
                  visits: values[r.userId]?.visits ?? "0",
                  quotations: values[r.userId]?.quotations ?? "0",
                })),
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
