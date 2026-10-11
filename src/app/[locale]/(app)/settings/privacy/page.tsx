import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PrivacySettingsForm } from "@/components/privacy/privacy-settings-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { processingActivities } from "@/lib/privacy";
import { requirePermission } from "@/server/auth/page-guard";
import { getCompanySettings } from "@/server/organizations/settings";
import { getPrivacySettings } from "@/server/privacy/retention";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy.settings");
  return { title: t("title") };
}

/**
 * Loi 18-07 (CLAUDE.md §7 Personal data): the retention periods the app applies every night and
 * the register of the processing it performs for the organization, to keep with its ANPDP
 * declaration.
 */
export default async function PrivacySettingsPage({
  params,
}: PageProps<"/[locale]/settings/privacy">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("organization:update");
  const settings = await getPrivacySettings(ctx);
  const company = await getCompanySettings(ctx);
  const t = await getTranslations("privacy");
  const retention = (key: (typeof processingActivities)[number]["retention"]) => {
    if (key === null) return null;
    const months = settings[key];
    return months > 0 ? t("register.automatic", { months }) : t("register.notSet");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={t("settings.title")} description={t("settings.description")} />
      <PrivacySettingsForm current={settings} />

      <section className="space-y-4" data-testid="processing-register">
        <div className="space-y-1">
          <h2 className="text-title">{t("register.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("register.description", { company: company.legalName ?? company.name })}
          </p>
        </div>
        {processingActivities.map((activity) => (
          <Card key={activity.key} data-activity={activity.key}>
            <CardHeader>
              <CardTitle>{t(`register.activities.${activity.key}.name`)}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
                {(["purpose", "data", "basis", "recipients", "retention"] as const).map((field) => (
                  <div key={field} className="contents">
                    <dt className="text-muted-foreground">{t(`register.fields.${field}`)}</dt>
                    <dd>
                      {t(`register.activities.${activity.key}.${field}`)}
                      {field === "retention" && retention(activity.retention) ? (
                        <span className="block font-medium">{retention(activity.retention)}</span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
        <p className="text-xs text-muted-foreground">{t("register.note")}</p>
      </section>
    </div>
  );
}
