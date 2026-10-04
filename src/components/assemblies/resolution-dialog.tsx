"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { majorities } from "@/lib/assemblies";
import type { AppErrorShape } from "@/lib/result";
import { addResolutionAction, updateResolutionAction } from "@/server/assemblies/actions";
import type { ResolutionRow } from "@/server/assemblies/queries";
import { addResolutionSchema } from "@/server/assemblies/schemas";

type ResolutionValues = z.input<typeof addResolutionSchema>;

/** Adds a resolution to the agenda (no `resolution`) or edits one, while the assembly is a draft. */
export function ResolutionDialog({
  assemblyId,
  resolution,
}: {
  assemblyId: string;
  resolution?: ResolutionRow;
}) {
  const t = useTranslations("assemblies");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const add = useAction(addResolutionAction);
  const update = useAction(updateResolutionAction);
  const form = useForm<ResolutionValues, unknown, z.output<typeof addResolutionSchema>>({
    resolver: zodResolver(addResolutionSchema),
    defaultValues: {
      assemblyId,
      title: resolution?.title ?? "",
      titleAr: resolution?.titleAr ?? "",
      description: resolution?.description ?? "",
      majority: resolution?.majority ?? "simple",
    },
  });

  function submit() {
    const values = form.getValues();
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (resolution) {
      const { assemblyId: _a, ...fields } = values;
      return update.run(
        { ...fields, resolutionId: resolution.id },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            setOpen(false);
          },
          onError,
        },
      );
    }
    return add.run(values, {
      onSuccess: () => {
        toast.success(t("agenda.added"));
        form.reset();
        setOpen(false);
      },
      onError,
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        resolution ? (
          <Button variant="ghost" size="sm">
            <Pencil data-icon="inline-start" />
            {tc("edit")}
          </Button>
        ) : (
          <Button variant="outline">
            <Plus data-icon="inline-start" />
            {t("agenda.add")}
          </Button>
        )
      }
      title={resolution ? t("agenda.editTitle") : t("agenda.addTitle")}
      submitLabel={resolution ? tc("save") : t("agenda.addSubmit")}
      pending={add.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      <TextField control={form.control} name="title" label={t("fields.title")} />
      <TextField control={form.control} name="titleAr" label={t("fields.titleAr")} dir="rtl" />
      <TextareaField
        control={form.control}
        name="description"
        label={t("fields.description")}
        rows={4}
      />
      <SelectField
        control={form.control}
        name="majority"
        label={t("fields.majority")}
        description={t("majorityHint")}
        options={majorities.map((m) => ({ value: m, label: t(`majority.${m}`) }))}
      />
    </FormDialog>
  );
}
