import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { toLocale } from "@/i18n/locales";

import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgotPassword");
  return { title: t("title") };
}

export default async function ForgotPasswordPage({
  params,
}: PageProps<"/[locale]/forgot-password">) {
  setRequestLocale(toLocale((await params).locale));
  return <ForgotPasswordForm />;
}
