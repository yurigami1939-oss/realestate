"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, SelectField } from "@/components/forms/fields";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { whatsappLanguages, whatsappTemplates } from "@/lib/whatsapp";
import { saveWhatsappSettingsAction } from "@/server/whatsapp/actions";
import { whatsappSettingsSchema } from "@/server/whatsapp/schemas";

export type WhatsappFormValues = z.input<typeof whatsappSettingsSchema>;

/**
 * The WhatsApp Business number (Cloud API) and the notifications sent from it, each switched on
 * once its template is approved in WhatsApp Manager (the texts to submit are shown).
 */
export function WhatsappForm({
  defaultValues,
  saved,
}: {
  defaultValues: WhatsappFormValues;
  /** The secrets already saved (empty fields keep them). */
  saved: { token: boolean; appSecret: boolean };
}) {
  const t = useTranslations("whatsapp.settings");
  const tk = useTranslations("whatsapp.kind");
  const tl = useTranslations("whatsapp.language");
  const translate = useTranslateKey();
  const save = useAction(saveWhatsappSettingsAction);
  const form = useForm<WhatsappFormValues, unknown, z.output<typeof whatsappSettingsSchema>>({
    resolver: zodResolver(whatsappSettingsSchema),
    defaultValues,
  });

  return (
    <form
      className="space-y-6"
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("saved"));
            form.resetField("accessToken", { defaultValue: "" });
            form.resetField("appSecret", { defaultValue: "" });
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
      noValidate
    >
      <Card>
        <CardContent>
          <FieldGroup>
            <CheckboxField control={form.control} name="enabled" label={t("enabled")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="phoneNumberId"
                label={t("phoneNumberId")}
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
              />
              <TextField
                control={form.control}
                name="businessAccountId"
                label={t("businessAccountId")}
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="accessToken"
                label={t("accessToken")}
                description={saved.token ? t("secretKept") : t("accessTokenHint")}
                type="password"
                dir="ltr"
                autoComplete="new-password"
              />
              <TextField
                control={form.control}
                name="appSecret"
                label={t("appSecret")}
                description={saved.appSecret ? t("secretKept") : t("appSecretHint")}
                type="password"
                dir="ltr"
                autoComplete="new-password"
              />
            </div>
            <SelectField
              control={form.control}
              name="language"
              label={t("language")}
              description={t("languageHint")}
              options={whatsappLanguages.map((l) => ({ value: l, label: tl(l) }))}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("notifications")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("notificationsHint")}</p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y" data-testid="whatsapp-notifications">
            {defaultValues.notifications.map((n, index) => {
              const template = whatsappTemplates[n.kind];
              const checkboxId = `notification-${n.kind}`;
              return (
                <li key={n.kind} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Controller
                      control={form.control}
                      name={`notifications.${index}.enabled`}
                      render={({ field }) => (
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={checkboxId}
                            checked={field.value}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                          />
                          <Label htmlFor={checkboxId} className="font-medium">
                            {tk(n.kind)}
                          </Label>
                        </div>
                      )}
                    />
                    <Controller
                      control={form.control}
                      name={`notifications.${index}.template`}
                      render={({ field, fieldState }) => (
                        <div className="w-full sm:w-64">
                          <Input
                            {...field}
                            dir="ltr"
                            placeholder={template.name}
                            aria-label={t("templateName", { kind: tk(n.kind) })}
                            aria-invalid={fieldState.invalid}
                          />
                          {fieldState.error?.message ? (
                            <FieldError
                              errors={[{ message: translate(fieldState.error.message) }]}
                            />
                          ) : null}
                        </div>
                      )}
                    />
                  </div>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      {t("templateText", { name: template.name })}
                    </summary>
                    <p className="mt-2 rounded-md bg-muted p-2" dir="ltr" lang="fr">
                      {template.fr}
                    </p>
                    <p className="mt-2 rounded-md bg-muted p-2" dir="rtl" lang="ar">
                      {template.ar}
                    </p>
                  </details>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Button type="submit" disabled={save.pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
