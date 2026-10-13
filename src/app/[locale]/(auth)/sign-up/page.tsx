import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { safeNext } from "@/lib/safe-next";
import { getSession } from "@/server/auth/session";
import { findLiveProvision } from "@/server/console/provisions";
import { demoModeEnabled } from "@/server/demo";
import { env } from "@/env";

import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signUp");
  return { title: t("title") };
}

export default async function SignUpPage({ params, searchParams }: PageProps<"/[locale]/sign-up">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const query = await searchParams;
  const token = typeof query.provision === "string" ? query.provision : null;
  const provision = demoModeEnabled() ? null : await findLiveProvision(token);
  const next = provision
    ? `/onboarding?provision=${encodeURIComponent(token ?? "")}`
    : safeNext(query.next, "/onboarding");

  if (await getSession()) redirect({ href: next, locale });

  if (demoModeEnabled()) {
    // The demo creates no account (CLAUDE.console.md §13): its accounts are on the sign-in page.
    const t = await getTranslations("demo.signUpClosed");
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t("title")}</h1>
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardFooter className="text-sm">
          <Link href="/sign-in#demo-accounts">{t("link")}</Link>
        </CardFooter>
      </Card>
    );
  }

  // Accounts come from an invitation or a provision (CLAUDE.console.md §8), unless OPEN_SIGNUP.
  const invited = next.startsWith("/accept-invitation/");
  if (!provision && !invited && env.OPEN_SIGNUP !== true) {
    const t = await getTranslations("auth.signUp");
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t("closedTitle")}</h1>
          </CardTitle>
          <CardDescription>{t("closedText")}</CardDescription>
        </CardHeader>
        <CardFooter className="text-sm">
          <Link href="/sign-in">{t("signInLink")}</Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <SignUpForm
      next={next}
      provision={
        provision ? { email: provision.email, organization: provision.legalName } : undefined
      }
    />
  );
}
