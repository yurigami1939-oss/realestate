"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronRight } from "lucide-react";
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
import type { Role } from "@/lib/permissions";
import { signInSchema } from "@/server/auth/schemas";

type Values = z.input<typeof signInSchema>;

/** The demo deployment's accounts (CLAUDE.console.md §13) and their password; null elsewhere. */
type DemoSignIn = { password: string; accounts: { email: string; role: Role }[] } | null;

export function SignInForm({ next, demo }: { next: string; demo: DemoSignIn }) {
  const t = useTranslations("auth");
  const tDemo = useTranslations("demo.accounts");
  const tRoles = useTranslations("roles");
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

  /** A demo account: the form filled for it, then sent. */
  function signInAs(email: string) {
    if (!demo || form.formState.isSubmitting) return;
    form.setValue("email", email);
    form.setValue("password", demo.password);
    void form.handleSubmit(onSubmit)();
  }

  const signUpHref =
    next === "/dashboard" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`;

  return (
    <>
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
          {demo ? null : (
            <p className="text-muted-foreground">
              {t("signIn.noAccount")}{" "}
              <Link
                href={signUpHref}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {t("signIn.signUpLink")}
              </Link>
            </p>
          )}
        </CardFooter>
      </Card>
      {demo ? (
        <Card id="demo-accounts" data-testid="demo-accounts">
          <CardHeader>
            <CardTitle>
              <h2>{tDemo("title")}</h2>
            </CardTitle>
            <CardDescription>{tDemo("description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="divide-y overflow-hidden rounded-xl bg-muted/50">
              {demo.accounts.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => signInAs(account.email)}
                    disabled={form.formState.isSubmitting}
                    aria-label={tDemo("signInAs", { role: tRoles(account.role) })}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-muted disabled:opacity-60 pointer-coarse:py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{tRoles(account.role)}</span>
                      <span className="block truncate text-footnote text-muted-foreground">
                        <bdi dir="ltr">{account.email}</bdi>
                      </span>
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground/60 rtl:rotate-180"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-center text-footnote text-muted-foreground">
              {tDemo("password")}{" "}
              <code className="font-mono text-foreground" dir="ltr">
                {demo.password}
              </code>
            </p>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
