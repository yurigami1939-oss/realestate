import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { TwoFactorSettings } from "@/components/auth/two-factor-settings";
import { toLocale } from "@/i18n/locales";
import { requireOperator } from "@/server/console/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("console.security");
  return { title: t("title") };
}

/** The operator's own security: two-factor authentication, required before anything else. */
export default async function ConsoleSecurityPage({
  params,
}: PageProps<"/[locale]/console/security">) {
  setRequestLocale(toLocale((await params).locale));
  const operator = await requireOperator({ enrolling: true });
  const t = await getTranslations("console.security");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {operator.twoFactorEnabled ? null : (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
          {t("required")}
        </p>
      )}
      <TwoFactorSettings enabled={operator.twoFactorEnabled} />
    </div>
  );
}
