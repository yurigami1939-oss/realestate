"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { WILAYA_OPTIONS, WilayaOptions } from "@/components/forms/wilaya-options";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { chargeFrequencies } from "@/lib/residences";
import { createResidenceAction, updateResidenceAction } from "@/server/residences/actions";
import { createResidenceSchema } from "@/server/residences/schemas";

export type ResidenceFormValues = z.input<typeof createResidenceSchema>;

/** Create (no `residenceId`) or edit a residence; the project is chosen at creation only. */
export function ResidenceForm({
  residenceId,
  projects,
  defaultValues,
}: {
  residenceId?: string;
  projects: { id: string; name: string }[];
  defaultValues: ResidenceFormValues;
}) {
  const t = useTranslations("residences");
  const tc = useTranslations("common");
  const router = useRouter();
  const create = useAction(createResidenceAction);
  const update = useAction(updateResidenceAction);
  const form = useForm<ResidenceFormValues, unknown, z.output<typeof createResidenceSchema>>({
    resolver: zodResolver(createResidenceSchema),
    defaultValues,
  });
  const f = (key: Exclude<keyof ResidenceFormValues, "notes"> | "notes") => t(`fields.${key}`);

  async function onSubmit(values: ResidenceFormValues) {
    if (residenceId) {
      const { projectId: _projectId, ...fields } = values;
      await update.run(
        { ...fields, residenceId },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            router.push(`/residences/${residenceId}`);
          },
          onError: (error) => applyFieldErrors(form, error),
        },
      );
      return;
    }
    await create.run(values, {
      onSuccess: ({ id, units }) => {
        toast.success(t("created", { count: units }));
        router.push(`/residences/${id}`);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))} noValidate>
          <FieldGroup>
            {residenceId ? null : (
              <SelectField
                control={form.control}
                name="projectId"
                label={f("projectId")}
                description={t("fields.projectHint")}
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
            <TextField control={form.control} name="name" label={f("name")} />
            <TextField control={form.control} name="address" label={f("address")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="commune" label={f("commune")} />
              <TextField
                control={form.control}
                name="wilaya"
                label={f("wilaya")}
                list={WILAYA_OPTIONS}
              />
              <WilayaOptions />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="shareBasis"
                label={f("shareBasis")}
                description={t("fields.shareBasisHint")}
                inputMode="numeric"
                dir="ltr"
              />
              <SelectField
                control={form.control}
                name="chargeFrequency"
                label={f("chargeFrequency")}
                options={chargeFrequencies.map((v) => ({ value: v, label: t(`frequency.${v}`) }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="reserveFund"
                label={f("reserveFund")}
                description={t("fields.reserveFundHint")}
                inputMode="decimal"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="callDueDays"
                label={f("callDueDays")}
                inputMode="numeric"
                dir="ltr"
              />
            </div>
            <TextareaField control={form.control} name="notes" label={f("notes")} rows={3} />
            <div className="flex gap-2">
              <Button type="submit" disabled={create.pending || update.pending}>
                {residenceId ? tc("save") : tc("create")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                {tc("cancel")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
