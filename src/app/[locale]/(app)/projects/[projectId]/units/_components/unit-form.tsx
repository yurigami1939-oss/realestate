"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import {
  CheckboxField,
  CheckboxGroupField,
  SelectField,
  TextareaField,
} from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { orientations, typologies, unitTypes } from "@/lib/inventory";
import type { AppErrorShape } from "@/lib/result";
import { createUnitAction, updateUnitAction } from "@/server/inventory/actions";
import { unitFields } from "@/server/inventory/schemas";

export type UnitFormValues = z.input<typeof unitFields>;

export type BuildingOption = { id: string; name: string; lowestFloor: number; topFloor: number };

/** Create (no `unitId`) or edit a unit sheet. Price and status have their own dialogs. */
export function UnitForm({
  projectId,
  unitId,
  buildings,
  defaultValues,
}: {
  projectId: string;
  unitId?: string;
  buildings: BuildingOption[];
  defaultValues: UnitFormValues;
}) {
  const t = useTranslations("inventory");
  const tc = useTranslations("common");
  const router = useRouter();
  const create = useAction(createUnitAction);
  const update = useAction(updateUnitAction);
  const form = useForm<UnitFormValues, unknown, z.output<typeof unitFields>>({
    resolver: zodResolver(unitFields),
    defaultValues,
  });
  const f = useTranslations("inventory.units.fields");

  async function onSubmit(values: UnitFormValues) {
    const onError = (error: AppErrorShape) =>
      applyFieldErrors(form, error, { "inventory.errors.codeTaken": "code" });
    if (unitId) {
      await update.run(
        { ...values, unitId },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            router.push(`/projects/${projectId}/units/${unitId}`);
          },
          onError,
        },
      );
    } else {
      await create.run(values, {
        onSuccess: ({ id }) => {
          toast.success(t("units.created"));
          router.push(`/projects/${projectId}/units/${id}`);
        },
        onError,
      });
    }
  }

  return (
    <Card>
      <CardContent>
        <form
          id="unit-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                control={form.control}
                name="buildingId"
                label={f("building")}
                options={buildings.map((b) => ({ value: b.id, label: b.name }))}
              />
              <TextField control={form.control} name="code" label={f("code")} dir="ltr" />
              <TextField
                control={form.control}
                name="floor"
                label={f("floor")}
                inputMode="numeric"
                dir="ltr"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                control={form.control}
                name="type"
                label={f("type")}
                options={unitTypes.map((v) => ({ value: v, label: t(`unitType.${v}`) }))}
              />
              <SelectField
                control={form.control}
                name="typology"
                label={f("typology")}
                emptyLabel="—"
                options={typologies.map((v) => ({ value: v, label: v }))}
              />
              <div className="flex items-end pb-2">
                <CheckboxField control={form.control} name="isDuplex" label={f("isDuplex")} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                control={form.control}
                name="livingArea"
                label={f("livingArea")}
                inputMode="decimal"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="usableArea"
                label={f("usableArea")}
                inputMode="decimal"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="outdoorArea"
                label={f("outdoorArea")}
                inputMode="decimal"
                dir="ltr"
              />
            </div>
            <CheckboxGroupField
              control={form.control}
              name="orientations"
              label={f("orientations")}
              columns={4}
              options={orientations.map((o) => ({ value: o, label: t(`orientation.${o}`) }))}
            />
            <TextField
              control={form.control}
              name="share"
              label={f("share")}
              inputMode="numeric"
              dir="ltr"
            />
            <TextareaField control={form.control} name="notes" label={f("notes")} />
            <div className="flex gap-2">
              <Button type="submit" disabled={create.pending || update.pending}>
                {unitId ? tc("save") : tc("create")}
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
