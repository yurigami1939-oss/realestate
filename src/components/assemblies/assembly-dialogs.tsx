"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Gavel, Pencil, Plus } from "lucide-react";
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
import { useRouter } from "@/i18n/navigation";
import { assemblyKinds } from "@/lib/assemblies";
import type { AppErrorShape } from "@/lib/result";
import {
  closeAssemblyAction,
  createAssemblyAction,
  updateAssemblyAction,
} from "@/server/assemblies/actions";
import { closeAssemblySchema, createAssemblySchema } from "@/server/assemblies/schemas";

type AssemblyValues = z.input<typeof createAssemblySchema>;

/** Create (no `assembly`) or edit a draft general assembly of a residence. */
export function AssemblyDialog({
  residenceId,
  assembly,
  today,
}: {
  residenceId: string;
  assembly?: {
    id: string;
    kind: AssemblyValues["kind"];
    heldOn: string;
    startTime: string;
    place: string;
    notes: string | null;
  };
  today: string;
}) {
  const t = useTranslations("assemblies");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = useAction(createAssemblyAction);
  const update = useAction(updateAssemblyAction);
  const form = useForm<AssemblyValues, unknown, z.output<typeof createAssemblySchema>>({
    resolver: zodResolver(createAssemblySchema),
    defaultValues: {
      residenceId,
      kind: assembly?.kind ?? "ordinary",
      heldOn: assembly?.heldOn ?? today,
      startTime: assembly?.startTime ?? "18:00",
      place: assembly?.place ?? "",
      notes: assembly?.notes ?? "",
    },
  });

  function submit() {
    const values = form.getValues();
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (assembly) {
      const { residenceId: _r, ...fields } = values;
      return update.run(
        { ...fields, assemblyId: assembly.id },
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
      onSuccess: ({ id }) => {
        toast.success(t("created"));
        setOpen(false);
        router.push(`/residences/${residenceId}/assemblies/${id}`);
      },
      onError,
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        assembly ? (
          <Button variant="outline">
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
      title={assembly ? t("editTitle") : t("newTitle")}
      description={assembly ? undefined : t("newDescription")}
      submitLabel={assembly ? tc("save") : tc("create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      <SelectField
        control={form.control}
        name="kind"
        label={t("fields.kind")}
        options={assemblyKinds.map((k) => ({ value: k, label: t(`kindLabel.${k}`) }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="heldOn" label={t("fields.heldOn")} type="date" />
        <TextField
          control={form.control}
          name="startTime"
          label={t("fields.startTime")}
          type="time"
          dir="ltr"
        />
      </div>
      <TextField control={form.control} name="place" label={t("fields.place")} />
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

type CloseValues = z.input<typeof closeAssemblySchema>;

/** Closes a held assembly: bureau and end time for the minutes; results become final. */
export function CloseAssemblyDialog({ assemblyId }: { assemblyId: string }) {
  const t = useTranslations("assemblies");
  const [open, setOpen] = useState(false);
  const close = useAction(closeAssemblyAction);
  const form = useForm<CloseValues, unknown, z.output<typeof closeAssemblySchema>>({
    resolver: zodResolver(closeAssemblySchema),
    defaultValues: { assemblyId, chairName: "", secretaryName: "", endTime: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Gavel data-icon="inline-start" />
          {t("close.label")}
        </Button>
      }
      title={t("close.title")}
      description={t("close.description")}
      submitLabel={t("close.submit")}
      pending={close.pending}
      onSubmit={form.handleSubmit(() =>
        close.run(form.getValues(), {
          onSuccess: ({ adopted, resolutions }) => {
            toast.success(t("close.done", { adopted, count: resolutions }));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="chairName" label={t("fields.chairName")} />
      <TextField control={form.control} name="secretaryName" label={t("fields.secretaryName")} />
      <TextField
        control={form.control}
        name="endTime"
        label={t("fields.endTime")}
        type="time"
        dir="ltr"
      />
    </FormDialog>
  );
}
