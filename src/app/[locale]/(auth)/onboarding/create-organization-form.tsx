"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormAlert } from "@/components/forms/form-alert";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { createOrganizationSchema, slugify } from "@/server/auth/schemas";

type Values = z.input<typeof createOrganizationSchema>;

export function CreateOrganizationForm({ hasExisting }: { hasExisting: boolean }) {
  const t = useTranslations("onboarding");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: "", slug: "", legalName: "" },
  });

  // The slug follows the name until the user edits it.
  function onNameChange(name: string) {
    if (!form.getFieldState("slug").isDirty) form.setValue("slug", slugify(name));
  }

  async function onSubmit(values: Values) {
    setError(null);
    const { name, slug, legalName } = createOrganizationSchema.parse(values);
    const { data, error: authError } = await authClient.organization.create({
      name,
      slug,
      legalName: legalName || undefined,
    });
    if (authError || !data) {
      setError(
        authError?.code === "ORGANIZATION_SLUG_ALREADY_TAKEN" ||
          authError?.code === "ORGANIZATION_ALREADY_EXISTS"
          ? t("slugTaken")
          : tErrors("UNEXPECTED"),
      );
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{hasExisting ? <h2>{t("createNew")}</h2> : <h1>{t("title")}</h1>}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="create-organization" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <FormAlert message={error} />
            <TextField
              control={form.control}
              name="name"
              label={t("name")}
              autoComplete="organization"
              onValueChange={onNameChange}
            />
            <TextField
              control={form.control}
              name="slug"
              label={t("slug")}
              description={t("slugHint")}
              dir="ltr"
            />
            <TextField control={form.control} name="legalName" label={t("legalName")} />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t("submit")}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
