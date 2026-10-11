"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  grantablePermissions,
  type Permission,
  type PermissionAction,
  type PermissionResource,
  rolePermissions,
  splitPermission,
  type StaffRole,
  staffRoles,
} from "@/lib/permissions";
import { createCustomRoleAction, updateCustomRoleAction } from "@/server/organizations/actions";
import { customRoleSchema } from "@/server/organizations/schemas";

type Values = z.input<typeof customRoleSchema>;

/** The catalog grouped by resource: `[resource, [permission, action][]]`. */
const groups = grantablePermissions.reduce<
  [PermissionResource, [Permission, PermissionAction][]][]
>((acc, p) => {
  const [resource, action] = splitPermission(p);
  const last = acc.at(-1);
  if (last && last[0] === resource) last[1].push([p, action]);
  else acc.push([resource, [[p, action]]]);
  return acc;
}, []);

/**
 * Creates or edits a custom role: its name, the staff role it starts from (its permissions are
 * proposed when it is chosen) and the exact permissions, resource by resource.
 */
export function CustomRoleDialog({
  current,
}: {
  current?: { id: string; name: string; baseRole: StaffRole; permissions: Permission[] };
}) {
  const t = useTranslations("customRoles");
  const tr = useTranslations("roles");
  const [open, setOpen] = useState(false);
  const create = useAction(createCustomRoleAction);
  const update = useAction(updateCustomRoleAction);
  const form = useForm<Values, unknown, z.output<typeof customRoleSchema>>({
    resolver: zodResolver(customRoleSchema),
    defaultValues: {
      name: current?.name ?? "",
      baseRole: current?.baseRole ?? "sales_agent",
      permissions: current?.permissions ?? rolePermissions("sales_agent"),
    },
  });
  const done = (message: string) => {
    toast.success(message);
    setOpen(false);
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      className="sm:max-w-3xl"
      trigger={
        current ? (
          <Button variant="outline" size="sm">
            <Pencil data-icon="inline-start" />
            {t("edit")}
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        )
      }
      title={current ? t("editTitle", { name: current.name }) : t("newTitle")}
      description={t("dialogDescription")}
      submitLabel={current ? t("save") : t("create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(() => {
        const values = form.getValues();
        const onError = (error: Parameters<typeof applyFieldErrors>[1]) =>
          applyFieldErrors(form, error);
        if (current) {
          void update.run(
            { ...values, customRoleId: current.id },
            { onSuccess: () => done(t("saved")), onError },
          );
        } else {
          void create.run(values, { onSuccess: () => done(t("created")), onError });
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="name" label={t("name")} />
        <SelectField
          control={form.control}
          name="baseRole"
          label={t("baseRole")}
          description={t("baseRoleHint")}
          options={staffRoles.map((r) => ({ value: r, label: tr(r) }))}
          onValueChange={(value) =>
            form.setValue("permissions", rolePermissions(value as StaffRole))
          }
        />
      </div>
      <Controller
        control={form.control}
        name="permissions"
        render={({ field, fieldState }) => {
          const chosen = new Set(field.value ?? []);
          const toggle = (p: Permission, on: boolean) => {
            const next = new Set(chosen);
            if (on) next.add(p);
            else next.delete(p);
            field.onChange(grantablePermissions.filter((g) => next.has(g)));
          };
          return (
            <fieldset className="space-y-2" data-testid="role-permissions">
              <legend className="text-sm font-medium">{t("permissions")}</legend>
              <div className="max-h-96 divide-y overflow-y-auto rounded-md border">
                {groups.map(([resource, actions]) => (
                  <div key={resource} className="grid gap-2 p-2 text-sm sm:grid-cols-[12rem_1fr]">
                    <span className="font-medium">{t(`resources.${resource}`)}</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {actions.map(([permission, action]) => (
                        <label key={permission} className="flex items-center gap-1.5">
                          <Checkbox
                            checked={chosen.has(permission)}
                            onCheckedChange={(on) => toggle(permission, on === true)}
                            aria-label={`${t(`resources.${resource}`)} · ${t(`actions.${action}`)}`}
                          />
                          {t(`actions.${action}`)}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {fieldState.error?.message ? (
                <p className="text-sm text-destructive">{t("errors.noPermission")}</p>
              ) : null}
            </fieldset>
          );
        }}
      />
    </FormDialog>
  );
}
