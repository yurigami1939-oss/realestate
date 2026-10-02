"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import type { AppErrorShape } from "@/lib/result";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { createBuildingAction, updateBuildingAction } from "@/server/inventory/actions";
import { buildingFields } from "@/server/inventory/schemas";

const formSchema = buildingFields.refine((v) => v.topFloor >= v.lowestFloor, {
  path: ["topFloor"],
  message: "validation.floorRange",
});
type Values = z.input<typeof formSchema>;

export type BuildingDefaults = {
  id: string;
  code: string;
  name: string;
  lowestFloor: number;
  topFloor: number;
};

/** Create a building in a project, or edit one (`building` given). */
export function BuildingDialog({
  projectId,
  building,
}: {
  projectId: string;
  building?: BuildingDefaults;
}) {
  const t = useTranslations("inventory.buildings");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const create = useAction(createBuildingAction);
  const update = useAction(updateBuildingAction);
  const form = useForm<Values, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: building
      ? {
          code: building.code,
          name: building.name,
          lowestFloor: String(building.lowestFloor),
          topFloor: String(building.topFloor),
        }
      : { code: "", name: "", lowestFloor: "0", topFloor: "" },
  });

  async function onSubmit(values: Values) {
    const onError = (error: AppErrorShape) =>
      applyFieldErrors(form, error, { "inventory.errors.codeTaken": "code" });
    const onSuccess = () => {
      toast.success(building ? tc("saved") : t("created"));
      setOpen(false);
      if (!building) form.reset();
    };
    if (building) await update.run({ ...values, buildingId: building.id }, { onSuccess, onError });
    else await create.run({ ...values, projectId }, { onSuccess, onError });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {building ? (
          <Button variant="outline">
            <Pencil data-icon="inline-start" />
            {tc("edit")}
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{building ? t("editTitle") : t("new")}</DialogTitle>
        </DialogHeader>
        <form
          id="building-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                control={form.control}
                name="code"
                label={t("fields.code")}
                description={t("fields.codeHint")}
                dir="ltr"
              />
              <div className="sm:col-span-2">
                <TextField control={form.control} name="name" label={t("fields.name")} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="lowestFloor"
                label={t("fields.lowestFloor")}
                description={t("fields.lowestFloorHint")}
                inputMode="numeric"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="topFloor"
                label={t("fields.topFloor")}
                inputMode="numeric"
                dir="ltr"
              />
            </div>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="building-form" disabled={create.pending || update.pending}>
            {building ? tc("save") : tc("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
