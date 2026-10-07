"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Gauge } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
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
import { formatDate } from "@/lib/dates";
import { saveMeterReadingsAction } from "@/server/charges/actions";
import { saveMeterReadingsSchema } from "@/server/charges/schemas";

type Values = z.input<typeof saveMeterReadingsSchema>;

export type MeterRow = {
  unitId: string;
  code: string;
  last: { readOn: string; reading: string } | null;
  previous: { readOn: string; reading: string } | null;
  /** Litres between the two latest readings, as text ("12,5 m³"), or null. */
  consumption: string | null;
};

/** m³ as typed and printed in French ("1 234,567"). */
const m3 = (value: string) => value.replace(".", ",");

/**
 * A reading campaign: the day, then each unit's new index (blank = not read); the latest
 * readings and consumption are shown alongside.
 */
export function MeterReadingsForm({
  residenceId,
  rows,
  today,
  editable,
}: {
  residenceId: string;
  rows: MeterRow[];
  today: string;
  editable: boolean;
}) {
  const t = useTranslations("charges.meters");
  const translate = useTranslateKey();
  const save = useAction(saveMeterReadingsAction);
  const form = useForm<Values, unknown, z.output<typeof saveMeterReadingsSchema>>({
    resolver: zodResolver(saveMeterReadingsSchema),
    defaultValues: {
      residenceId,
      readOn: today,
      readings: rows.map((r) => ({ unitId: r.unitId, reading: "" })),
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: ({ saved }) => {
            toast.success(t("saved", { count: saved }));
            form.reset({
              residenceId,
              readOn: form.getValues("readOn"),
              readings: rows.map((r) => ({ unitId: r.unitId, reading: "" })),
            });
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
      noValidate
    >
      {editable ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <TextField
              control={form.control}
              name="readOn"
              label={t("readOn")}
              type="date"
              dir="ltr"
              max={today}
            />
          </div>
          <Button type="submit" disabled={save.pending}>
            <Gauge data-icon="inline-start" />
            {t("save")}
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="meter-readings">
          <TableHeader>
            <TableRow>
              <TableHead>{t("unit")}</TableHead>
              <TableHead>{t("previous")}</TableHead>
              <TableHead>{t("last")}</TableHead>
              <TableHead className="text-end">{t("consumption")}</TableHead>
              {editable ? <TableHead>{t("newReading")}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.unitId} data-unit={row.code}>
                <TableCell className="font-medium">
                  <bdi dir="ltr">{row.code}</bdi>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.previous ? (
                    <>
                      <bdi dir="ltr">{m3(row.previous.reading)}</bdi> ·{" "}
                      {formatDate(row.previous.readOn)}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {row.last ? (
                    <>
                      <bdi dir="ltr">{m3(row.last.reading)}</bdi> · {formatDate(row.last.readOn)}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {row.consumption ?? "—"}
                </TableCell>
                {editable ? (
                  <TableCell className="w-40">
                    <Controller
                      control={form.control}
                      name={`readings.${index}.reading`}
                      render={({ field, fieldState }) => (
                        <div className="space-y-1">
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            inputMode="decimal"
                            dir="ltr"
                            aria-label={t("readingOf", { code: row.code })}
                            aria-invalid={fieldState.invalid}
                          />
                          {fieldState.error?.message ? (
                            <p className="text-xs text-destructive">
                              {translate(fieldState.error.message)}
                            </p>
                          ) : null}
                        </div>
                      )}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </form>
  );
}
