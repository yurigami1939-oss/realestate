"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, CalendarCheck, FileText, Pencil, Plus, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { UploadButton } from "@/components/files/upload-button";
import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import {
  checkCategories,
  checkFrequencies,
  checkKinds,
  checkResults,
  nextCheckDue,
} from "@/lib/maintenance";
import {
  archiveCheckAction,
  createCheckAction,
  recordVisitAction,
  updateCheckAction,
} from "@/server/maintenance/actions";
import { createCheckSchema, recordVisitSchema } from "@/server/maintenance/schemas";

type SupplierOption = { id: string; name: string };
type CheckValues = Omit<z.input<typeof createCheckSchema>, "residenceId">;

const NONE = "";

/** A new deadline of a residence, or one corrected (`checkId` and its values). */
export function CheckDialog({
  residenceId,
  checkId,
  values,
  suppliers,
  today,
}: {
  residenceId: string;
  checkId?: string;
  values?: CheckValues;
  suppliers: SupplierOption[];
  today: string;
}) {
  const t = useTranslations("maintenance");
  const [open, setOpen] = useState(false);
  const create = useAction(createCheckAction);
  const update = useAction(updateCheckAction);
  const form = useForm<
    z.input<typeof createCheckSchema>,
    unknown,
    z.output<typeof createCheckSchema>
  >({
    resolver: zodResolver(createCheckSchema),
    defaultValues: {
      residenceId,
      ...(values ?? {
        kind: "inspection",
        category: "lift",
        title: "",
        supplierId: NONE,
        frequencyMonths: "12",
        nextDueOn: today,
        reference: "",
        notes: "",
      }),
    },
  });
  const done = (message: string) => {
    toast.success(message);
    setOpen(false);
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        checkId ? (
          <Button variant="ghost" size="icon" className="size-8" aria-label={t("edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        )
      }
      title={checkId ? t("editTitle") : t("newTitle")}
      description={t("formDescription")}
      submitLabel={checkId ? t("save") : t("new")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(() => {
        const { residenceId: _r, ...raw } = form.getValues();
        const onError = (error: Parameters<typeof applyFieldErrors>[1]) =>
          applyFieldErrors(form, error);
        if (checkId) {
          void update.run({ ...raw, checkId }, { onSuccess: () => done(t("saved")), onError });
        } else {
          void create.run(
            { ...raw, residenceId },
            {
              onSuccess: () => {
                done(t("created"));
                form.reset();
              },
              onError,
            },
          );
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="kind"
          label={t("fields.kind")}
          options={checkKinds.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
        />
        <SelectField
          control={form.control}
          name="category"
          label={t("fields.category")}
          options={checkCategories.map((c) => ({ value: c, label: t(`category.${c}`) }))}
        />
      </div>
      <TextField control={form.control} name="title" label={t("fields.title")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="supplierId"
          label={t("fields.supplier")}
          options={[
            { value: NONE, label: t("noSupplier") },
            ...suppliers.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <SelectField
          control={form.control}
          name="frequencyMonths"
          label={t("fields.frequency")}
          options={[
            { value: "", label: t("oneOff") },
            ...checkFrequencies.map((m) => ({
              value: String(m),
              label: t("everyMonths", { count: m }),
            })),
          ]}
        />
        <TextField
          control={form.control}
          name="nextDueOn"
          label={t("fields.nextDueOn")}
          type="date"
          dir="ltr"
        />
        <TextField control={form.control} name="reference" label={t("fields.reference")} />
      </div>
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

/** A visit done: its day, outcome and cost; the next deadline follows the frequency. */
export function VisitDialog({
  checkId,
  frequencyMonths,
  supplierId,
  suppliers,
  today,
}: {
  checkId: string;
  frequencyMonths: number | null;
  supplierId: string | null;
  suppliers: SupplierOption[];
  today: string;
}) {
  const t = useTranslations("maintenance");
  const [open, setOpen] = useState(false);
  const record = useAction(recordVisitAction);
  const form = useForm<
    z.input<typeof recordVisitSchema>,
    unknown,
    z.output<typeof recordVisitSchema>
  >({
    resolver: zodResolver(recordVisitSchema),
    defaultValues: {
      checkId,
      doneOn: today,
      supplierId: supplierId ?? NONE,
      result: "compliant",
      notes: "",
      cost: "",
      nextDueOn: nextCheckDue(today, frequencyMonths) ?? "",
    },
  });
  const doneOn = useWatch({ control: form.control, name: "doneOn" });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <CalendarCheck data-icon="inline-start" />
          {t("recordVisit")}
        </Button>
      }
      title={t("visitTitle")}
      submitLabel={t("recordVisit")}
      pending={record.pending}
      onSubmit={form.handleSubmit(() =>
        record.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("visitRecorded"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="doneOn"
          label={t("fields.doneOn")}
          type="date"
          dir="ltr"
          max={today}
          // The next deadline follows the visit's day (still editable).
          onValueChange={(value) => {
            const next = nextCheckDue(value, frequencyMonths);
            if (next) form.setValue("nextDueOn", next);
          }}
        />
        <SelectField
          control={form.control}
          name="result"
          label={t("fields.result")}
          options={checkResults.map((r) => ({ value: r, label: t(`result.${r}`) }))}
        />
        <SelectField
          control={form.control}
          name="supplierId"
          label={t("fields.doneBy")}
          options={[
            { value: NONE, label: t("noSupplier") },
            ...suppliers.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <TextField
          control={form.control}
          name="cost"
          label={t("fields.cost")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="nextDueOn"
          label={t("fields.nextAfter")}
          type="date"
          dir="ltr"
          min={doneOn}
        />
      </div>
      <TextareaField control={form.control} name="notes" label={t("fields.visitNotes")} rows={2} />
    </FormDialog>
  );
}

export function ArchiveCheckButton({ checkId }: { checkId: string }) {
  const t = useTranslations("maintenance");
  return (
    <ConfirmAction
      action={archiveCheckAction}
      input={{ checkId }}
      label={t("archive")}
      icon={<Archive />}
      title={t("archiveTitle")}
      description={t("archiveDescription")}
      confirmLabel={t("archive")}
      successMessage={t("archived")}
      variant="ghost"
      size="icon"
    />
  );
}

/** A visit's certificate: link, then attach or replace. */
export function VisitScan({
  visitId,
  fileId,
  editable,
}: {
  visitId: string;
  fileId: string | null;
  editable: boolean;
}) {
  const t = useTranslations("maintenance.scan");
  const router = useRouter();
  if (!fileId && !editable) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {fileId ? (
        <a
          href={`/api/files/${fileId}`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 font-medium hover:underline"
        >
          <FileText className="size-3.5" aria-hidden />
          {t("open")}
        </a>
      ) : null}
      {editable ? (
        <UploadButton
          purpose="residence_check.scan"
          entityId={visitId}
          label={fileId ? t("replace") : t("attach")}
          icon={<Upload data-icon="inline-start" />}
          variant="ghost"
          onUploaded={() => {
            toast.success(t("saved"));
            router.refresh();
          }}
        />
      ) : null}
    </span>
  );
}
