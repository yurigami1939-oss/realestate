"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import type { AppErrorShape } from "@/lib/result";
import { createSupplierAction, updateSupplierAction } from "@/server/suppliers/actions";
import { createSupplierSchema } from "@/server/suppliers/schemas";

type Values = z.input<typeof createSupplierSchema>;

export type SupplierFields = {
  id: string;
  name: string;
  activity: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  nif: string | null;
  rcNumber: string | null;
  rib: string | null;
  notes: string | null;
};

/** Create (no `supplier`) or edit a supplier. */
export function SupplierDialog({ supplier }: { supplier?: SupplierFields }) {
  const t = useTranslations("suppliers");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const create = useAction(createSupplierAction);
  const update = useAction(updateSupplierAction);
  const form = useForm<Values, unknown, z.output<typeof createSupplierSchema>>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: {
      name: supplier?.name ?? "",
      activity: supplier?.activity ?? "",
      phone: supplier?.phone ?? "",
      email: supplier?.email ?? "",
      address: supplier?.address ?? "",
      nif: supplier?.nif ?? "",
      rcNumber: supplier?.rcNumber ?? "",
      rib: supplier?.rib ?? "",
      notes: supplier?.notes ?? "",
    },
  });

  function submit() {
    const values = form.getValues();
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (supplier) {
      return update.run(
        { ...values, supplierId: supplier.id },
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
        supplier ? (
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
      title={supplier ? t("editTitle") : t("newTitle")}
      submitLabel={supplier ? tc("save") : tc("create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      <TextField control={form.control} name="name" label={t("fields.name")} />
      <TextField control={form.control} name="activity" label={t("fields.activity")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="phone"
          label={t("fields.phone")}
          type="tel"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="email"
          label={t("fields.email")}
          type="email"
          dir="ltr"
        />
      </div>
      <TextField control={form.control} name="address" label={t("fields.address")} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField control={form.control} name="nif" label={t("fields.nif")} dir="ltr" />
        <TextField control={form.control} name="rcNumber" label={t("fields.rcNumber")} dir="ltr" />
        <TextField control={form.control} name="rib" label={t("fields.rib")} dir="ltr" />
      </div>
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}
