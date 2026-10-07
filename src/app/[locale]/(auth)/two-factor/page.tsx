import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { safeNext } from "@/lib/safe-next";
import { getSession } from "@/server/auth/session";

import { TwoFactorForm } from "./two-factor-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.twoFactor");
  return { title: t("title") };
}

/** Second step of a sign-in with two-factor authentication on: the authenticator's code. */
export default async function TwoFactorPage({
  params,
  searchParams,
}: PageProps<"/[locale]/two-factor">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect({ href: next, locale });
  return <TwoFactorForm next={next} />;
}
