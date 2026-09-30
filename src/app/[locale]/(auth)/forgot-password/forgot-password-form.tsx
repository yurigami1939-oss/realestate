"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { FormAlert } from "@/components/forms/form-alert";
import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Link } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { forgotPasswordSchema } from "@/server/auth/schemas";

type Values = z.input<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [sent, setSent] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: Values) {
    // Same answer whether or not the account exists (no account enumeration).
    await authClient.requestPasswordReset({
      email: forgotPasswordSchema.parse(values).email,
      redirectTo: `/${locale}/reset-password`,
    });
    setSent(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("forgotPassword.title")}</h1>
        </CardTitle>
        <CardDescription>{t("forgotPassword.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <FormAlert tone="success" message={t("forgotPassword.sent")} />
        ) : (
          <form id="forgot-password" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <TextField
                control={form.control}
                name="email"
                label={t("fields.email")}
                type="email"
                autoComplete="email"
                dir="ltr"
              />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t("forgotPassword.submit")}
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
      <CardFooter className="text-sm">
        <Link href="/sign-in" className="text-muted-foreground underline-offset-4 hover:underline">
          {t("forgotPassword.backToSignIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
