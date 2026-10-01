"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxGroupField, SelectField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { distributionKeys, distributionWeightings } from "@/lib/residences";
import type { AppErrorShape } from "@/lib/result";
import { createChargeCategoryAction, updateChargeCategoryAction } from "@/server/charges/actions";
import type { ChargeCategoryRow, ChargesSetup } from "@/server/charges/queries";
import { createChargeCategorySchema } from "@/server/charges/schemas";

type Values = z.input<typeof createChargeCategorySchema>;

/** Create (no `category`) or edit a charge category and its distribution key. */
export function CategoryDialog({
  residenceId,
  category,
  buildings,
  units,
}: {
  residenceId: string;
  category?: ChargeCategoryRow;
  buildings: ChargesSetup["buildings"];
  units: ChargesSetup["units"];
}) {
  const t = useTranslations("charges");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const create = useAction(createChargeCategoryAction);
  const update = useAction(updateChargeCategoryAction);
  const form = useForm<Values, unknown, z.output<typeof createChargeCategorySchema>>({
    resolver: zodResolver(createChargeCategorySchema),
    defaultValues: {
      residenceId,
      name: category?.name ?? "",
      nameAr: category?.nameAr ?? "",
      key: category?.key ?? "share",
      weighting: category?.weighting ?? "share",
      buildingId: category?.buildingId ?? "",
      unitIds: category?.unitIds ?? [],
    },
  });
  const key = useWatch({ control: form.control, name: "key" });

  function submit() {
    const values = form.getValues();
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (category) {
      const { residenceId: _residenceId, ...fields } = values;
      return update.run(
        { ...fields, categoryId: category.id },
        {
          onSuccess: () => {
            toast.success(t("categories.updated"));
            setOpen(false);
          },
          onError,
        },
      );
    }
    return create.run(values, {
      onSuccess: () => {
        toast.success(t("categories.created"));
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
        category ? (
          <Button variant="ghost" size="sm">
            <Pencil data-icon="inline-start" />
            {tc("edit")}
          </Button>
        ) : (
          <Button variant="outline">
            <Plus data-icon="inline-start" />
            {t("categories.new")}
          </Button>
        )
      }
      title={
        category ? t("categories.editTitle", { name: category.name }) : t("categories.newTitle")
      }
      submitLabel={category ? tc("save") : tc("create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="name" label={t("fields.name")} />
        <TextField control={form.control} name="nameAr" label={t("fields.nameAr")} dir="rtl" />
      </div>
      <SelectField
        control={form.control}
        name="key"
        label={t("fields.key")}
        options={distributionKeys.map((k) => ({ value: k, label: t(`key.${k}`) }))}
      />
      {key === "per_building" ? (
        <SelectField
          control={form.control}
          name="buildingId"
          label={t("fields.buildingId")}
          options={buildings.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
        />
      ) : null}
      {key === "per_building" || key === "custom" ? (
        <SelectField
          control={form.control}
          name="weighting"
          label={t("fields.weighting")}
          options={distributionWeightings.map((w) => ({ value: w, label: t(`weighting.${w}`) }))}
        />
      ) : null}
      {key === "custom" ? (
        <CheckboxGroupField
          control={form.control}
          name="unitIds"
          label={t("fields.unitIds")}
          columns={4}
          options={units.map((u) => ({ value: u.unitId, label: u.code }))}
        />
      ) : null}
    </FormDialog>
  );
}
