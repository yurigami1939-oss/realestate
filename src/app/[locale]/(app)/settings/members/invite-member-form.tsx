"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { invitableRoles } from "@/lib/permissions";
import { inviteMemberAction } from "@/server/organizations/actions";
import { inviteMemberSchema } from "@/server/organizations/schemas";

type Values = z.input<typeof inviteMemberSchema>;

export function InviteMemberForm() {
  const t = useTranslations();
  const translate = useTranslateKey();
  const invite = useAction(inviteMemberAction);
  const form = useForm<Values>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "", roles: [] },
  });

  async function onSubmit(values: Values) {
    await invite.run(values, {
      onSuccess: () => {
        toast.success(t("members.invite.sent", { email: values.email }));
        form.reset();
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("members.invite.title")}</h2>
        </CardTitle>
        <CardDescription>{t("members.invite.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="invite-member" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <TextField
              control={form.control}
              name="email"
              label={t("members.invite.email")}
              type="email"
              autoComplete="off"
              dir="ltr"
            />
            <Controller
              control={form.control}
              name="roles"
              render={({ field, fieldState }) => (
                <FieldSet data-invalid={fieldState.invalid}>
                  <FieldLegend variant="label">{t("members.invite.roles")}</FieldLegend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {invitableRoles.map((role) => (
                      <Field key={role} orientation="horizontal">
                        <Checkbox
                          id={`invite-role-${role}`}
                          checked={field.value.includes(role)}
                          onCheckedChange={(checked) =>
                            field.onChange(
                              checked
                                ? [...field.value, role]
                                : field.value.filter((r) => r !== role),
                            )
                          }
                        />
                        <FieldLabel htmlFor={`invite-role-${role}`} className="font-normal">
                          {t(`roles.${role}`)}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                  {fieldState.error?.message ? (
                    <FieldError errors={[{ message: translate(fieldState.error.message) }]} />
                  ) : null}
                </FieldSet>
              )}
            />
            <Button type="submit" disabled={invite.pending}>
              {t("members.invite.submit")}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
