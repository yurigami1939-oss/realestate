import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { TwoFactorSettings } from "@/components/auth/two-factor-settings";
import { toLocale } from "@/i18n/locales";
import { requireTenantCtx } from "@/server/auth/page-guard";
import { getSession } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("security");
  return { title: t("title") };
}

/** The member's own sign-in security: two-factor authentication with an authenticator app. */
export default async function SecurityPage({ params }: PageProps<"/[locale]/settings/security">) {
  setRequestLocale(toLocale((await params).locale));
  await requireTenantCtx();
  const session = await getSession();
  const t = await getTranslations("security");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <TwoFactorSettings enabled={session?.user.twoFactorEnabled === true} />
    </div>
  );
}
