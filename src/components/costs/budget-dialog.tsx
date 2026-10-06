"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Calculator, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { FormDialog } from "@/components/forms/form-dialog";
import { useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type CostCategory, costCategories } from "@/lib/costs";
import { formatDZD, parseDZD } from "@/lib/money";
import { saveBudgetLinesAction } from "@/server/costs/actions";
import { saveBudgetLinesSchema } from "@/server/costs/schemas";

type Values = z.input<typeof saveBudgetLinesSchema>;

/** The project's budget (bilan prévisionnel), edited and saved as a whole. */
export function BudgetDialog({
  projectId,
  lines,
}: {
  projectId: string;
  lines: { category: CostCategory; label: string; amount: string }[];
}) {
  const t = useTranslations("costs");
  const tc = useTranslations("common");
  const translate = useTranslateKey();
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const save = useAction(saveBudgetLinesAction);
  const form = useForm<Values, unknown, z.output<typeof saveBudgetLinesSchema>>({
    resolver: zodResolver(saveBudgetLinesSchema),
    defaultValues: { projectId, lines },
  });
  const rows = useFieldArray({ control: form.control, name: "lines" });
  const current = useWatch({ control: form.control, name: "lines" });
  const total = current.reduce((sum, l) => sum + (parseDZD(l.amount.trim()) ?? 0n), 0n);
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Calculator data-icon="inline-start" />
          {t("budget.edit")}
        </Button>
      }
      title={t("budget.editTitle")}
      description={t("budget.editDescription")}
      submitLabel={tc("save")}
      pending={save.pending}
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("budget.saved"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <ol className="space-y-2" data-testid="budget-lines">
        {rows.fields.map((row, index) => (
          <li key={row.id} className="flex flex-wrap items-start gap-2">
            <Controller
              control={form.control}
              name={`lines.${index}.category`}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    className="w-40"
                    aria-label={`${t("fields.category")} ${index + 1}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {costCategories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`category.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <Controller
              control={form.control}
              name={`lines.${index}.label`}
              render={({ field, fieldState }) => (
                <div className="min-w-40 flex-1 space-y-1">
                  <Input
                    {...field}
                    aria-label={`${t("fields.label")} ${index + 1}`}
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
            <Controller
              control={form.control}
              name={`lines.${index}.amount`}
              render={({ field, fieldState }) => (
                <div className="w-40 space-y-1">
                  <Input
                    {...field}
                    inputMode="decimal"
                    dir="ltr"
                    aria-label={`${t("fields.amount")} ${index + 1}`}
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={tc("delete")}
              onClick={() => rows.remove(index)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => rows.append({ category: "works", label: "", amount: "" })}
        >
          <Plus data-icon="inline-start" />
          {t("budget.addLine")}
        </Button>
        <span className="text-sm font-medium tabular-nums" dir="ltr">
          {formatDZD(total, locale)}
        </span>
      </div>
    </FormDialog>
  );
}
