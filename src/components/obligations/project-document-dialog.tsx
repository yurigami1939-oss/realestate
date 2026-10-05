"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FilePlus2, Pencil } from "lucide-react";
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
import { type ProjectDocumentKind, projectDocumentKinds } from "@/lib/obligations";
import {
  createProjectDocumentAction,
  updateProjectDocumentAction,
} from "@/server/obligations/actions";
import { projectDocumentFormSchema } from "@/server/obligations/schemas";

type Values = z.input<typeof projectDocumentFormSchema>;

export type ProjectDocumentValues = {
  kind: ProjectDocumentKind;
  title: string;
  reference: string;
  issuedOn: string;
  expiresOn: string;
  issuer: string;
  notes: string;
};

/**
 * Adds a document to a project's regulatory file (`projectId`), or corrects one
 * (`documentId` with its current values).
 */
export function ProjectDocumentDialog(
  props:
    | { projectId: string; documentId?: undefined; values?: undefined }
    | { projectId?: undefined; documentId: string; values: ProjectDocumentValues },
) {
  const t = useTranslations("obligations.documents");
  const tc = useTranslations("common");
  const editing = props.documentId !== undefined;
  const [open, setOpen] = useState(false);
  const create = useAction(createProjectDocumentAction);
  const update = useAction(updateProjectDocumentAction);
  const form = useForm<Values, unknown, z.output<typeof projectDocumentFormSchema>>({
    resolver: zodResolver(projectDocumentFormSchema),
    defaultValues: {
      targetId: props.documentId ?? props.projectId,
      ...(props.values ?? {
        kind: "building_permit",
        title: "",
        reference: "",
        issuedOn: "",
        expiresOn: "",
        issuer: "",
        notes: "",
      }),
    },
  });
  const done = (message: string) => () => {
    toast.success(message);
    setOpen(false);
    if (!editing) form.reset();
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        editing ? (
          <Button variant="ghost" size="icon" className="size-8" aria-label={tc("edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <FilePlus2 data-icon="inline-start" />
            {t("add")}
          </Button>
        )
      }
      title={editing ? t("editTitle") : t("addTitle")}
      submitLabel={editing ? tc("save") : t("add")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(() => {
        const { targetId, ...fields } = form.getValues();
        const onError = (error: Parameters<typeof applyFieldErrors>[1]) =>
          applyFieldErrors(form, error);
        return editing
          ? update.run(
              { documentId: targetId, ...fields },
              { onSuccess: done(t("saved")), onError },
            )
          : create.run(
              { projectId: targetId, ...fields },
              { onSuccess: done(t("added")), onError },
            );
      })}
    >
      <SelectField
        control={form.control}
        name="kind"
        label={t("fields.kind")}
        options={projectDocumentKinds.map((kind) => ({ value: kind, label: t(`kind.${kind}`) }))}
      />
      <TextField control={form.control} name="title" label={t("fields.title")} maxLength={120} />
      <TextField control={form.control} name="reference" label={t("fields.reference")} dir="ltr" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="issuedOn"
          label={t("fields.issuedOn")}
          type="date"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="expiresOn"
          label={t("fields.expiresOn")}
          description={t("fields.expiresHelp")}
          type="date"
          dir="ltr"
        />
      </div>
      <TextField control={form.control} name="issuer" label={t("fields.issuer")} />
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}
