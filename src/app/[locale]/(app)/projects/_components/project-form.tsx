"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import type { AppErrorShape } from "@/lib/result";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { projectStatuses } from "@/lib/inventory";
import { createProjectAction, updateProjectAction } from "@/server/inventory/actions";
import { projectFields } from "@/server/inventory/schemas";

export type ProjectFormValues = z.input<typeof projectFields>;

export const emptyProject: ProjectFormValues = {
  code: "",
  name: "",
  status: "planning",
  address: "",
  wilaya: "",
  commune: "",
  buildingPermitNumber: "",
  buildingPermitDate: "",
  launchedOn: "",
  plannedDeliveryOn: "",
  description: "",
};

/** Create (no `projectId`) or edit a project. */
export function ProjectForm({
  projectId,
  defaultValues = emptyProject,
}: {
  projectId?: string;
  defaultValues?: ProjectFormValues;
}) {
  const t = useTranslations("inventory");
  const tc = useTranslations("common");
  const router = useRouter();
  const create = useAction(createProjectAction);
  const update = useAction(updateProjectAction);
  const form = useForm<ProjectFormValues, unknown, z.output<typeof projectFields>>({
    resolver: zodResolver(projectFields),
    defaultValues,
  });
  const f = (key: keyof ProjectFormValues) => t(`projects.fields.${key}`);
  const onError = (error: AppErrorShape) =>
    applyFieldErrors(form, error, { "inventory.errors.codeTaken": "code" });

  async function onSubmit(values: ProjectFormValues) {
    if (projectId) {
      await update.run(
        { ...values, projectId },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            router.push(`/projects/${projectId}`);
          },
          onError,
        },
      );
    } else {
      await create.run(values, {
        onSuccess: ({ id }) => {
          toast.success(t("projects.created"));
          router.push(`/projects/${id}`);
        },
        onError,
      });
    }
  }

  return (
    <Card>
      <CardContent>
        <form
          id="project-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <TextField control={form.control} name="name" label={f("name")} />
              </div>
              <TextField
                control={form.control}
                name="code"
                label={f("code")}
                description={t("projects.fields.codeHint")}
                dir="ltr"
                autoCapitalize="characters"
              />
            </div>
            <SelectField
              control={form.control}
              name="status"
              label={f("status")}
              options={projectStatuses.map((s) => ({ value: s, label: t(`projectStatus.${s}`) }))}
            />
            <TextField control={form.control} name="address" label={f("address")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="commune" label={f("commune")} />
              <TextField control={form.control} name="wilaya" label={f("wilaya")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="buildingPermitNumber"
                label={f("buildingPermitNumber")}
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="buildingPermitDate"
                label={f("buildingPermitDate")}
                type="date"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="launchedOn"
                label={f("launchedOn")}
                type="date"
              />
              <TextField
                control={form.control}
                name="plannedDeliveryOn"
                label={f("plannedDeliveryOn")}
                type="date"
              />
            </div>
            <TextareaField control={form.control} name="description" label={f("description")} />
            <div className="flex gap-2">
              <Button type="submit" disabled={create.pending || update.pending}>
                {projectId ? tc("save") : tc("create")}
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
