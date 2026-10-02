"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
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
import { resetPasswordSchema } from "@/server/auth/schemas";

type Values = z.input<typeof resetPasswordSchema>;

export function ResetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations("auth");
  const [status, setStatus] = useState<"idle" | "done" | "invalid">(token ? "idle" : "invalid");
  const form = useForm<Values>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "" },
  });

  async function onSubmit(values: Values) {
    if (!token) return;
    const { error } = await authClient.resetPassword({
      newPassword: resetPasswordSchema.parse(values).password,
      token,
    });
    setStatus(error ? "invalid" : "done");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("resetPassword.title")}</h1>
        </CardTitle>
        <CardDescription>{t("resetPassword.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {status === "done" ? (
          <FormAlert tone="success" message={t("resetPassword.success")} />
        ) : null}
        {status === "invalid" ? <FormAlert message={t("resetPassword.invalidToken")} /> : null}
        {status === "idle" ? (
          <form id="reset-password" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <TextField
                control={form.control}
                name="password"
                label={t("fields.newPassword")}
                type="password"
                autoComplete="new-password"
                dir="ltr"
              />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t("resetPassword.submit")}
              </Button>
            </FieldGroup>
          </form>
        ) : null}
      </CardContent>
      <CardFooter className="text-sm">
        <Link href="/sign-in" className="text-muted-foreground underline-offset-4 hover:underline">
          {t("forgotPassword.backToSignIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
