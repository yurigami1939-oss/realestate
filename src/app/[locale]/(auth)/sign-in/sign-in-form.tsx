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
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { signInSchema } from "@/server/auth/schemas";

type Values = z.input<typeof signInSchema>;

export function SignInForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: Values) {
    setError(null);
    const { data, error: authError } = await authClient.signIn.email(signInSchema.parse(values));
    if (authError) {
      setError(
        authError.code === "INVALID_EMAIL_OR_PASSWORD" || authError.status === 401
          ? t("signIn.invalidCredentials")
          : authError.status === 429
            ? tErrors("tooManyRequests")
            : tErrors("UNEXPECTED"),
      );
      return;
    }
    // Two-factor authentication on: the code page completes the sign-in.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.replace(`/two-factor?next=${encodeURIComponent(next)}`);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const signUpHref =
    next === "/dashboard" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("signIn.title")}</h1>
        </CardTitle>
        <CardDescription>{t("signIn.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="sign-in" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <FormAlert message={error} />
            <TextField
              control={form.control}
              name="email"
              label={t("fields.email")}
              type="email"
              autoComplete="email"
              dir="ltr"
            />
            <TextField
              control={form.control}
              name="password"
              label={t("fields.password")}
              type="password"
              autoComplete="current-password"
              dir="ltr"
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t("signIn.submit")}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2 text-sm">
        <Link
          href="/forgot-password"
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("signIn.forgotPassword")}
        </Link>
        <p className="text-muted-foreground">
          {t("signIn.noAccount")}{" "}
          <Link
            href={signUpHref}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("signIn.signUpLink")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
