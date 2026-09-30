import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { toLocale } from "@/i18n/locales";

import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.resetPassword");
  return { title: t("title") };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: PageProps<"/[locale]/reset-password">) {
  setRequestLocale(toLocale((await params).locale));
  const { token, error } = await searchParams;
  const validToken = typeof token === "string" && !error ? token : null;
  return <ResetPasswordForm token={validToken} />;
}
