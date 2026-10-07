"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Wallet, X } from "lucide-react";
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
import { formatDZD, parseDZD } from "@/lib/money";
import { type FinancingSource, financingSources } from "@/lib/sales";
import { saveSaleFinancingAction } from "@/server/sales/actions";
import { saveSaleFinancingSchema } from "@/server/sales/schemas";

type Values = z.input<typeof saveSaleFinancingSchema>;

/** The sale's financing plan (own funds, bank loan, aid…), edited and saved as a whole. */
export function FinancingDialog({
  reservationId,
  price,
  lines,
}: {
  reservationId: string;
  price: bigint;
  /** The current plan, as form values. */
  lines: { source: FinancingSource; expected: string; reference: string }[];
}) {
  const t = useTranslations("sales.financing");
  const tc = useTranslations("common");
  const translate = useTranslateKey();
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const save = useAction(saveSaleFinancingAction);
  const form = useForm<Values, unknown, z.output<typeof saveSaleFinancingSchema>>({
    resolver: zodResolver(saveSaleFinancingSchema),
    defaultValues: { reservationId, lines },
  });
  const rows = useFieldArray({ control: form.control, name: "lines" });
  const current = useWatch({ control: form.control, name: "lines" });
  const total = current.reduce((sum, l) => sum + (parseDZD(l.expected.trim()) ?? 0n), 0n);
  const unused = financingSources.filter((s) => !current.some((l) => l.source === s));
  const linesError = form.formState.errors.lines;
  const rootMessage = linesError?.message ?? linesError?.root?.message;
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <Wallet data-icon="inline-start" />
          {t("edit")}
        </Button>
      }
      title={t("editTitle")}
      description={t("editDescription", { price: formatDZD(price, locale) })}
      submitLabel={tc("save")}
      pending={save.pending}
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("saved"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <ol className="space-y-2" data-testid="financing-lines">
        {rows.fields.map((row, index) => (
          <li key={row.id} className="flex flex-wrap items-start gap-2">
            <Controller
              control={form.control}
              name={`lines.${index}.source`}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-48" aria-label={`${t("fields.source")} ${index + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {financingSources.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`source.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <Controller
              control={form.control}
              name={`lines.${index}.expected`}
              render={({ field, fieldState }) => (
                <div className="w-40 space-y-1">
                  <Input
                    {...field}
                    inputMode="decimal"
                    dir="ltr"
                    aria-label={`${t("fields.expected")} ${index + 1}`}
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
              name={`lines.${index}.reference`}
              render={({ field }) => (
                <Input
                  {...field}
                  value={field.value ?? ""}
                  className="min-w-40 flex-1"
                  placeholder={t("fields.referenceHint")}
                  aria-label={`${t("fields.reference")} ${index + 1}`}
                />
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
      {rootMessage ? <p className="text-sm text-destructive">{translate(rootMessage)}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {unused[0] ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              rows.append({ source: unused[0] ?? "other", expected: "", reference: "" })
            }
          >
            <Plus data-icon="inline-start" />
            {t("addLine")}
          </Button>
        ) : (
          <span />
        )}
        <span className="text-sm tabular-nums" data-testid="financing-total">
          {t("totalLine", {
            total: formatDZD(total, locale),
            rest: formatDZD(price - total, locale),
          })}
        </span>
      </div>
    </FormDialog>
  );
}
