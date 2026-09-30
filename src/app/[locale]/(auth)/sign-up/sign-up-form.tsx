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
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { signUpSchema } from "@/server/auth/schemas";

type Values = z.input<typeof signUpSchema>;

export function SignUpForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: Values) {
    setError(null);
    const { error: authError } = await authClient.signUp.email({
      ...signUpSchema.parse(values),
      locale,
    });
    if (authError) {
      setError(
        authError.code?.startsWith("USER_ALREADY_EXISTS")
          ? t("signUp.emailTaken")
          : tErrors("UNEXPECTED"),
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const signInHref = `/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("signUp.title")}</h1>
        </CardTitle>
        <CardDescription>{t("signUp.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="sign-up" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <FormAlert message={error} />
            <TextField
              control={form.control}
              name="name"
              label={t("fields.name")}
              autoComplete="name"
            />
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
              autoComplete="new-password"
              dir="ltr"
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t("signUp.submit")}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        {t("signUp.haveAccount")}{" "}
        <Link
          href={signInHref}
          className="ms-1 font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("signUp.signInLink")}
        </Link>
      </CardFooter>
    </Card>
  );
}
