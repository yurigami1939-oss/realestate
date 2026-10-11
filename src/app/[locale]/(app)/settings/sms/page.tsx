import { Info } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { SmsSettingsForm, TestSmsDialog } from "@/components/sms/sms-ui";
import { toLocale } from "@/i18n/locales";
import { requirePermission } from "@/server/auth/page-guard";
import { getSmsSettings } from "@/server/sms/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sms.settings");
  return { title: t("title") };
}

/** The gérant's SMS account and the notifications sent by SMS (CLAUDE.md §7 SMS). */
export default async function SmsSettingsPage({ params }: PageProps<"/[locale]/settings/sms">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("organization:update");
  const { settings, standIn } = await getSmsSettings(ctx);
  const t = await getTranslations("sms.settings");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={settings?.enabled ? <TestSmsDialog /> : null}
      />
      {standIn ? (
        <p
          className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900"
          data-testid="sms-stand-in"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("standIn")}
        </p>
      ) : null}
      <SmsSettingsForm current={settings} hasKey={settings !== null} />
      <p className="text-sm text-muted-foreground">{t("protocol")}</p>
    </div>
  );
}
