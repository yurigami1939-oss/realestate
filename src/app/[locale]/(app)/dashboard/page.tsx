import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { toLocale } from "@/i18n/locales";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return { title: t("title") };
}

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  setRequestLocale(toLocale((await params).locale));
  const t = await getTranslations("home");
  return (
    <main className="space-y-2 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground">{t("subtitle")}</p>
      <SignOutButton />
    </main>
  );
}
