"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClock, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextareaField } from "@/components/forms/fields";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addMonths } from "@/lib/dates";
import { allocate, formatDZD, parseDZD, toDecimalString } from "@/lib/money";
import { cn } from "@/lib/utils";
import { rescheduleSaleAction } from "@/server/sales/actions";
import { rescheduleSaleSchema } from "@/server/sales/schemas";

type Values = z.input<typeof rescheduleSaleSchema>;
type LineValues = Values["lines"][number];

/** "8000000,00" as typed in amount inputs. */
const asInput = (v: bigint) => toDecimalString(v).replace(".", ",");
const AT_DATE = "__date__";

/**
 * Avenant: replaces the installments not fully paid by new lines (dates or milestones not
 * reached) totalling the same; a helper spreads the rest in equal monthly installments.
 */
export function RescheduleDialog({
  reservationId,
  today,
  minDate,
  replaced,
  milestones,
}: {
  reservationId: string;
  today: string;
  /** The amendment cannot predate the reservation. */
  minDate: string;
  /** Installments not fully paid: what the amendment replaces. */
  replaced: { label: string; amount: bigint; dueOn: string | null; milestoneId: string | null }[];
  /** Milestones of the project not reached yet. */
  milestones: { id: string; name: string }[];
}) {
  const t = useTranslations("sales.reschedule");
  const tc = useTranslations("common");
  const translate = useTranslateKey();
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, locale);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("6");
  const [firstOn, setFirstOn] = useState(today);
  const reschedule = useAction(rescheduleSaleAction);
  const expected = replaced.reduce((sum, l) => sum + l.amount, 0n);
  const reachable = new Set(milestones.map((m) => m.id));
  const defaults: LineValues[] = replaced.map((l) => ({
    label: l.label,
    amount: asInput(l.amount),
    dueOn: l.dueOn ?? "",
    milestoneId: l.milestoneId && reachable.has(l.milestoneId) ? l.milestoneId : "",
  }));
  const form = useForm<Values, unknown, z.output<typeof rescheduleSaleSchema>>({
    resolver: zodResolver(rescheduleSaleSchema),
    defaultValues: { reservationId, signedOn: today, reason: "", lines: defaults },
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const watched = useWatch({ control: form.control, name: "lines" });
  const total = watched.reduce((sum, l) => sum + (parseDZD(l.amount ?? "") ?? 0n), 0n);
  const linesError =
    form.formState.errors.lines?.root?.message ?? form.formState.errors.lines?.message;

  const spread = () => {
    const n = Number.parseInt(count, 10);
    if (!Number.isInteger(n) || n < 1 || n > 36 || !/^\d{4}-\d{2}-\d{2}$/.test(firstOn)) return;
    const parts = allocate(
      expected,
      Array.from({ length: n }, () => 1),
    );
    lines.replace(
      parts.map((amount, index) => ({
        label: t("monthly", { number: index + 1, count: n }),
        amount: asInput(amount),
        dueOn: addMonths(firstOn, index),
        milestoneId: "",
      })),
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarClock data-icon="inline-start" />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint", { amount: money(expected) })}</DialogDescription>
        </DialogHeader>
        <form
          id="reschedule-form"
          onSubmit={form.handleSubmit(() =>
            reschedule.run(form.getValues(), {
              onSuccess: ({ sequence }) => {
                toast.success(t("done", { number: sequence }));
                setOpen(false);
              },
              onError: (error) => applyFieldErrors(form, error),
            }),
          )}
          noValidate
          className="max-h-[70vh] overflow-y-auto pe-1"
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="signedOn"
                label={t("signedOn")}
                type="date"
                dir="ltr"
                min={minDate}
                max={today}
              />
            </div>
            <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />

            <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/50 p-2">
              <div className="space-y-1">
                <Label htmlFor="spread-count">{t("spreadCount")}</Label>
                <Input
                  id="spread-count"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  className="w-20"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spread-first">{t("spreadFirst")}</Label>
                <Input
                  id="spread-first"
                  type="date"
                  value={firstOn}
                  onChange={(e) => setFirstOn(e.target.value)}
                  dir="ltr"
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={spread}>
                {t("spread")}
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("lines")}</p>
              {lines.fields.map((row, index) => {
                const err = form.formState.errors.lines?.[index];
                const milestoneId = watched[index]?.milestoneId ?? "";
                return (
                  <div
                    key={row.id}
                    className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_9rem_12rem_auto]"
                    data-testid="amendment-line"
                  >
                    <Controller
                      control={form.control}
                      name={`lines.${index}.label`}
                      render={({ field }) => (
                        <Input
                          {...field}
                          aria-label={`${t("line.label")} ${index + 1}`}
                          aria-invalid={Boolean(err?.label)}
                          placeholder={t("line.label")}
                        />
                      )}
                    />
                    <Controller
                      control={form.control}
                      name={`lines.${index}.amount`}
                      render={({ field }) => (
                        <Input
                          {...field}
                          aria-label={`${t("line.amount")} ${index + 1}`}
                          aria-invalid={Boolean(err?.amount)}
                          inputMode="decimal"
                          dir="ltr"
                        />
                      )}
                    />
                    <div className="space-y-1">
                      <Controller
                        control={form.control}
                        name={`lines.${index}.milestoneId`}
                        render={({ field }) => (
                          <Select
                            value={field.value || AT_DATE}
                            onValueChange={(v) => field.onChange(v === AT_DATE ? "" : v)}
                          >
                            <SelectTrigger
                              className="w-full"
                              aria-label={`${t("line.due")} ${index + 1}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={AT_DATE}>{t("line.atDate")}</SelectItem>
                              {milestones.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      {milestoneId === "" ? (
                        <Controller
                          control={form.control}
                          name={`lines.${index}.dueOn`}
                          render={({ field }) => (
                            <Input
                              {...field}
                              value={field.value ?? ""}
                              type="date"
                              dir="ltr"
                              aria-label={`${t("line.dueOn")} ${index + 1}`}
                              aria-invalid={Boolean(err?.dueOn)}
                            />
                          )}
                        />
                      ) : null}
                      {err?.dueOn?.message ? (
                        <p className="text-xs text-destructive">{translate(err.dueOn.message)}</p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => lines.remove(index)}
                      aria-label={t("removeLine")}
                    >
                      <X />
                    </Button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    lines.append({
                      label: t("line.default", { number: lines.fields.length + 1 }),
                      amount: "",
                      dueOn: "",
                      milestoneId: "",
                    })
                  }
                >
                  <Plus data-icon="inline-start" />
                  {t("addLine")}
                </Button>
                <span
                  className={cn(
                    "text-sm font-medium",
                    total === expected ? "text-emerald-700" : "text-rose-700",
                  )}
                  data-testid="amendment-total"
                >
                  {t("total", { total: money(total), expected: money(expected) })}
                </span>
              </div>
              {linesError ? (
                <p className="text-sm text-destructive">{translate(linesError)}</p>
              ) : null}
            </div>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="reschedule-form"
            disabled={reschedule.pending || total !== expected}
          >
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
