import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { safeNext } from "@/lib/safe-next";
import { getSession } from "@/server/auth/session";

import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signUp");
  return { title: t("title") };
}

export default async function SignUpPage({ params, searchParams }: PageProps<"/[locale]/sign-up">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const next = safeNext((await searchParams).next, "/onboarding");

  if (await getSession()) redirect({ href: next, locale });

  return <SignUpForm next={next} />;
}
