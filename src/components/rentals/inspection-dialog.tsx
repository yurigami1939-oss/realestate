"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardCheck, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inspectionConditions, type InspectionKind, type LeaseKind } from "@/lib/rentals";
import { recordInspectionAction } from "@/server/rentals/actions";
import { recordInspectionSchema } from "@/server/rentals/schemas";

type Values = z.input<typeof recordInspectionSchema>;

/**
 * Records the état des lieux d'entrée or de sortie: one row per element of the unit (prefilled
 * with the usual ones, or at check-out with those of the entry), its condition and remarks,
 * the meters and keys. Final once recorded.
 */
export function InspectionDialog({
  leaseId,
  kind,
  leaseKind,
  today,
  entryElements,
}: {
  leaseId: string;
  kind: InspectionKind;
  leaseKind: LeaseKind;
  today: string;
  /** Elements of the entry inspection, reused at check-out. */
  entryElements: string[];
}) {
  const t = useTranslations("rentals.inspection");
  const translate = useTranslateKey();
  const [open, setOpen] = useState(false);
  const record = useAction(recordInspectionAction);
  const elements = entryElements.length > 0 ? entryElements : t(`defaults.${leaseKind}`).split("|");
  const form = useForm<Values, unknown, z.output<typeof recordInspectionSchema>>({
    resolver: zodResolver(recordInspectionSchema),
    defaultValues: {
      leaseId,
      kind,
      inspectedOn: today,
      items: elements.map((element) => ({ element, condition: "good", notes: "" })),
      electricityMeter: "",
      gasMeter: "",
      waterMeter: "",
      keysCount: "",
      observations: "",
    },
  });
  const items = useFieldArray({ control: form.control, name: "items" });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <ClipboardCheck data-icon="inline-start" />
          {t(`open.${kind}`)}
        </Button>
      }
      title={t(`title.${kind}`)}
      description={t("description")}
      submitLabel={t("submit")}
      pending={record.pending}
      onSubmit={form.handleSubmit(() =>
        record.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="inspectedOn"
        label={t("date")}
        type="date"
        dir="ltr"
        max={today}
      />
      <FieldSet>
        <FieldLegend variant="label">{t("elements")}</FieldLegend>
        <ul className="space-y-2" data-testid="inspection-items">
          {items.fields.map((field, index) => (
            <li key={field.id} className="grid gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]">
              <Controller
                control={form.control}
                name={`items.${index}.element`}
                render={({ field: input, fieldState }) => (
                  <div>
                    <Input
                      {...input}
                      aria-label={t("element", { index: index + 1 })}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.error?.message ? (
                      <FieldError errors={[{ message: translate(fieldState.error.message) }]} />
                    ) : null}
                  </div>
                )}
              />
              <Controller
                control={form.control}
                name={`items.${index}.condition`}
                render={({ field: input }) => (
                  <Select value={input.value} onValueChange={input.onChange}>
                    <SelectTrigger
                      className="w-full"
                      aria-label={t("condition", { index: index + 1 })}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {inspectionConditions.map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`conditions.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <Controller
                control={form.control}
                name={`items.${index}.notes`}
                render={({ field: input }) => (
                  <Input
                    {...input}
                    value={input.value ?? ""}
                    placeholder={t("notes")}
                    aria-label={t("notesOf", { index: index + 1 })}
                  />
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("remove", { index: index + 1 })}
                onClick={() => items.remove(index)}
                disabled={items.fields.length === 1}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => items.append({ element: "", condition: "good", notes: "" })}
          >
            <Plus data-icon="inline-start" />
            {t("add")}
          </Button>
        </div>
      </FieldSet>
      <div className="grid gap-4 sm:grid-cols-4">
        <TextField
          control={form.control}
          name="keysCount"
          label={t("keys")}
          inputMode="numeric"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="electricityMeter"
          label={t("electricity")}
          dir="ltr"
        />
        <TextField control={form.control} name="gasMeter" label={t("gas")} dir="ltr" />
        <TextField control={form.control} name="waterMeter" label={t("water")} dir="ltr" />
      </div>
      <TextareaField
        control={form.control}
        name="observations"
        label={t("observations")}
        rows={2}
      />
    </FormDialog>
  );
}
