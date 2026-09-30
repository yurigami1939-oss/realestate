"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { defaultUnitCode, typologies, unitTypes } from "@/lib/inventory";
import { generateUnitsAction } from "@/server/inventory/actions";
import { generateUnitsSchema } from "@/server/inventory/schemas";

type Values = z.input<typeof generateUnitsSchema>;

export function GenerateUnitsDialog({
  building,
}: {
  building: { id: string; code: string; lowestFloor: number; topFloor: number };
}) {
  const t = useTranslations("inventory");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const generate = useAction(generateUnitsAction);
  const form = useForm<Values, unknown, z.output<typeof generateUnitsSchema>>({
    resolver: zodResolver(generateUnitsSchema),
    defaultValues: {
      buildingId: building.id,
      fromFloor: String(Math.max(building.lowestFloor, Math.min(1, building.topFloor))),
      toFloor: String(building.topFloor),
      unitsPerFloor: "4",
      type: "apartment",
      typology: "",
      livingArea: "",
    },
  });

  async function onSubmit(values: Values) {
    await generate.run(values, {
      onSuccess: (result) => {
        toast.success(t("generate.result", result));
        setOpen(false);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Wand2 data-icon="inline-start" />
          {t("generate.title")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("generate.title")}</DialogTitle>
          <DialogDescription>
            {t.rich("generate.description", {
              example: defaultUnitCode(building.code, 3, 2),
              code: (chunks) => (
                <bdi dir="ltr" className="font-mono whitespace-nowrap">
                  {chunks}
                </bdi>
              ),
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          id="generate-units"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                control={form.control}
                name="fromFloor"
                label={t("generate.fromFloor")}
                inputMode="numeric"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="toFloor"
                label={t("generate.toFloor")}
                inputMode="numeric"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="unitsPerFloor"
                label={t("generate.unitsPerFloor")}
                inputMode="numeric"
                dir="ltr"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                control={form.control}
                name="type"
                label={t("units.fields.type")}
                options={unitTypes.map((v) => ({ value: v, label: t(`unitType.${v}`) }))}
              />
              <SelectField
                control={form.control}
                name="typology"
                label={t("units.fields.typology")}
                emptyLabel="—"
                options={typologies.map((v) => ({ value: v, label: v }))}
              />
              <TextField
                control={form.control}
                name="livingArea"
                label={t("units.fields.livingArea")}
                inputMode="decimal"
                dir="ltr"
              />
            </div>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="generate-units" disabled={generate.pending}>
            {t("generate.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
