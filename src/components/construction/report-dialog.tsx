"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import type { AppErrorShape } from "@/lib/result";
import { createReportAction, updateReportAction } from "@/server/construction/actions";
import type { ConstructionReportRow } from "@/server/construction/queries";
import { createReportSchema } from "@/server/construction/schemas";

type Values = z.input<typeof createReportSchema>;

type BuildingOption = { id: string; name: string; progress: { percent: number } | null };

/**
 * Writes a progress report (no `report`) or edits one: date, text in French (Arabic optional),
 * visibility on the portal and the progress of each building (prefilled with its current one).
 */
export function ReportDialog({
  projectId,
  buildings,
  today,
  report,
}: {
  projectId: string;
  buildings: BuildingOption[];
  today: string;
  report?: ConstructionReportRow;
}) {
  const t = useTranslations("construction.report");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const create = useAction(createReportAction);
  const update = useAction(updateReportAction);
  const defaults = (): Values => ({
    projectId,
    reportedOn: report?.reportedOn ?? today,
    title: report?.title ?? "",
    titleAr: report?.titleAr ?? "",
    body: report?.body ?? "",
    bodyAr: report?.bodyAr ?? "",
    published: report?.published ?? true,
    progress: buildings.map((b) => {
      const percent = report
        ? report.progress.find((p) => p.buildingId === b.id)?.percent
        : b.progress?.percent;
      return { buildingId: b.id, percent: percent === undefined ? "" : String(percent) };
    }),
  });
  const form = useForm<Values, unknown, z.output<typeof createReportSchema>>({
    resolver: zodResolver(createReportSchema),
    defaultValues: defaults(),
  });

  function submit() {
    const values = form.getValues();
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (report) {
      const { projectId: _p, ...fields } = values;
      return update.run(
        { ...fields, reportId: report.id },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            setOpen(false);
          },
          onError,
        },
      );
    }
    return create.run(values, {
      onSuccess: () => {
        toast.success(t("created"));
        setOpen(false);
      },
      onError,
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        // A new report starts again from the buildings' current progress.
        if (next) form.reset(defaults());
        setOpen(next);
      }}
      trigger={
        report ? (
          <Button variant="ghost" size="sm">
            <Pencil data-icon="inline-start" />
            {tc("edit")}
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        )
      }
      title={report ? t("editTitle") : t("newTitle")}
      description={report ? undefined : t("newDescription")}
      submitLabel={report ? tc("save") : tc("create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      <TextField
        control={form.control}
        name="reportedOn"
        label={t("fields.reportedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
      <TextField control={form.control} name="title" label={t("fields.title")} />
      <TextareaField control={form.control} name="body" label={t("fields.body")} rows={4} />
      <TextField control={form.control} name="titleAr" label={t("fields.titleAr")} dir="rtl" />
      <TextareaField
        control={form.control}
        name="bodyAr"
        label={t("fields.bodyAr")}
        rows={4}
        dir="rtl"
      />
      {buildings.length > 0 ? (
        <FieldSet>
          <FieldLegend variant="label">{t("fields.progress")}</FieldLegend>
          <FieldDescription>{t("fields.progressHint")}</FieldDescription>
          <div className="grid gap-3 sm:grid-cols-2">
            {buildings.map((b, index) => (
              <TextField
                key={b.id}
                control={form.control}
                name={`progress.${index}.percent`}
                label={t("fields.buildingPercent", { name: b.name })}
                inputMode="numeric"
                dir="ltr"
              />
            ))}
          </div>
        </FieldSet>
      ) : null}
      <CheckboxField control={form.control} name="published" label={t("fields.published")} />
    </FormDialog>
  );
}
