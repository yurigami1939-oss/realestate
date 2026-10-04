"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { formatAmountInput } from "@/lib/money";
import type { AppErrorShape } from "@/lib/result";
import { createContractAction, updateContractAction } from "@/server/suppliers/actions";
import type { ContractRow, ContractTarget } from "@/server/suppliers/queries";
import { createContractSchema } from "@/server/suppliers/schemas";

type Values = z.input<typeof createContractSchema>;

/**
 * Create or edit a supplier contract. The supplier and the residence are fixed by the page
 * they are opened from, or chosen; the category list follows the residence.
 */
export function ContractDialog({
  contract,
  supplierId,
  residenceId,
  suppliers,
  targets,
  today,
}: {
  contract?: ContractRow;
  supplierId?: string;
  residenceId?: string;
  suppliers?: { id: string; name: string }[];
  targets: ContractTarget[];
  today: string;
}) {
  const t = useTranslations("suppliers.contracts");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const create = useAction(createContractAction);
  const update = useAction(updateContractAction);
  const form = useForm<Values, unknown, z.output<typeof createContractSchema>>({
    resolver: zodResolver(createContractSchema),
    defaultValues: {
      supplierId: contract?.supplierId ?? supplierId ?? "",
      residenceId: contract?.residenceId ?? residenceId ?? targets[0]?.id ?? "",
      categoryId: contract?.categoryId ?? "",
      label: contract?.label ?? "",
      startOn: contract?.startOn ?? today,
      endOn: contract?.endOn ?? "",
      annualAmount: contract?.annualAmount != null ? formatAmountInput(contract.annualAmount) : "",
      notes: contract?.notes ?? "",
    },
  });
  const chosenResidence = useWatch({ control: form.control, name: "residenceId" });
  const categories = targets.find((r) => r.id === chosenResidence)?.categories ?? [];

  function submit() {
    const values = form.getValues();
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (contract) {
      const { supplierId: _s, residenceId: _r, ...fields } = values;
      return update.run(
        { ...fields, contractId: contract.id },
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
        contract ? (
          <Button variant="ghost" size="sm">
            <Pencil data-icon="inline-start" />
            {tc("edit")}
          </Button>
        ) : (
          <Button variant="outline">
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        )
      }
      title={contract ? t("editTitle") : t("newTitle")}
      submitLabel={contract ? tc("save") : tc("create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      {!contract && !supplierId && suppliers ? (
        <SelectField
          control={form.control}
          name="supplierId"
          label={t("fields.supplierId")}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
      ) : null}
      {!contract && !residenceId ? (
        <SelectField
          control={form.control}
          name="residenceId"
          label={t("fields.residenceId")}
          options={targets.map((r) => ({ value: r.id, label: r.name }))}
        />
      ) : null}
      <SelectField
        key={chosenResidence}
        control={form.control}
        name="categoryId"
        label={t("fields.categoryId")}
        emptyLabel={t("noCategory")}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
      />
      <TextField control={form.control} name="label" label={t("fields.label")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="startOn"
          label={t("fields.startOn")}
          type="date"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="endOn"
          label={t("fields.endOn")}
          type="date"
          dir="ltr"
        />
      </div>
      <TextField
        control={form.control}
        name="annualAmount"
        label={t("fields.annualAmount")}
        inputMode="decimal"
        dir="ltr"
      />
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}
