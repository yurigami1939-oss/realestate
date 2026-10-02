import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { safeNext } from "@/lib/safe-next";
import { getSession } from "@/server/auth/session";

import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signIn");
  return { title: t("title") };
}

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const next = safeNext((await searchParams).next);

  if (await getSession()) redirect({ href: next, locale });

  return <SignInForm next={next} />;
}
