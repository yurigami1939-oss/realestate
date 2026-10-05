"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, SelectField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { gatewayEnvironments } from "@/lib/online-payments";
import { saveGatewaySettingsAction } from "@/server/online-payments/actions";
import { gatewaySettingsSchema } from "@/server/online-payments/schemas";

export type GatewayFormValues = z.input<typeof gatewaySettingsSchema>;

/** The SATIM merchant account; the saved password is never shown (empty = keep it). */
export function GatewayForm({
  defaultValues,
  hasPassword,
}: {
  defaultValues: GatewayFormValues;
  hasPassword: boolean;
}) {
  const t = useTranslations("onlinePayments.settings");
  const te = useTranslations("onlinePayments.environment");
  const save = useAction(saveGatewaySettingsAction);
  const form = useForm<GatewayFormValues, unknown, z.output<typeof gatewaySettingsSchema>>({
    resolver: zodResolver(gatewaySettingsSchema),
    defaultValues,
  });

  return (
    <Card>
      <CardContent>
        <form
          onSubmit={form.handleSubmit(() =>
            save.run(form.getValues(), {
              onSuccess: () => {
                toast.success(t("saved"));
                form.resetField("password", { defaultValue: "" });
              },
              onError: (error) => applyFieldErrors(form, error),
            }),
          )}
          noValidate
        >
          <FieldGroup>
            <CheckboxField control={form.control} name="enabled" label={t("enabled")} />
            <SelectField
              control={form.control}
              name="environment"
              label={t("environment")}
              description={t("environmentHint")}
              options={gatewayEnvironments.map((e) => ({ value: e, label: te(e) }))}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                control={form.control}
                name="username"
                label={t("username")}
                dir="ltr"
                autoComplete="off"
              />
              <TextField
                control={form.control}
                name="password"
                label={t("password")}
                description={hasPassword ? t("passwordKept") : undefined}
                type="password"
                dir="ltr"
                autoComplete="new-password"
              />
              <TextField
                control={form.control}
                name="terminalId"
                label={t("terminalId")}
                dir="ltr"
                autoComplete="off"
              />
            </div>
            <FieldSet>
              <FieldLegend variant="label">{t("accounts")}</FieldLegend>
              <CheckboxField control={form.control} name="salesEnabled" label={t("salesEnabled")} />
              <CheckboxField
                control={form.control}
                name="chargesEnabled"
                label={t("chargesEnabled")}
              />
            </FieldSet>
            <div>
              <Button type="submit" disabled={save.pending}>
                {t("submit")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
