"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { announcementCategories } from "@/lib/announcements";
import type { AppErrorShape } from "@/lib/result";
import { createAnnouncementAction, updateAnnouncementAction } from "@/server/announcements/actions";
import type { AnnouncementRow } from "@/server/announcements/queries";
import { createAnnouncementSchema } from "@/server/announcements/schemas";

type AnnouncementValues = z.input<typeof createAnnouncementSchema>;

/** Writes a new announcement (no `announcement`) or edits a draft. */
export function AnnouncementDialog({
  residenceId,
  announcement,
}: {
  residenceId: string;
  announcement?: AnnouncementRow;
}) {
  const t = useTranslations("announcements");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const create = useAction(createAnnouncementAction);
  const update = useAction(updateAnnouncementAction);
  const form = useForm<AnnouncementValues, unknown, z.output<typeof createAnnouncementSchema>>({
    resolver: zodResolver(createAnnouncementSchema),
    defaultValues: {
      residenceId,
      category: announcement?.category ?? "general",
      title: announcement?.title ?? "",
      titleAr: announcement?.titleAr ?? "",
      body: announcement?.body ?? "",
      bodyAr: announcement?.bodyAr ?? "",
      expiresOn: announcement?.expiresOn ?? "",
      pinned: announcement?.pinned ?? false,
    },
  });

  function submit() {
    const values = form.getValues();
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (announcement) {
      const { residenceId: _r, ...fields } = values;
      return update.run(
        { ...fields, announcementId: announcement.id },
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
        announcement ? (
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
      title={announcement ? t("editTitle") : t("newTitle")}
      description={announcement ? undefined : t("newDescription")}
      submitLabel={announcement ? tc("save") : tc("create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      <SelectField
        control={form.control}
        name="category"
        label={t("fields.category")}
        options={announcementCategories.map((c) => ({ value: c, label: t(`category.${c}`) }))}
      />
      <TextField control={form.control} name="title" label={t("fields.title")} />
      <TextareaField control={form.control} name="body" label={t("fields.body")} rows={5} />
      <TextField control={form.control} name="titleAr" label={t("fields.titleAr")} dir="rtl" />
      <TextareaField
        control={form.control}
        name="bodyAr"
        label={t("fields.bodyAr")}
        rows={5}
        dir="rtl"
      />
      <TextField
        control={form.control}
        name="expiresOn"
        label={t("fields.expiresOn")}
        description={t("fields.expiresOnHint")}
        type="date"
      />
      <CheckboxField control={form.control} name="pinned" label={t("fields.pinned")} />
    </FormDialog>
  );
}
