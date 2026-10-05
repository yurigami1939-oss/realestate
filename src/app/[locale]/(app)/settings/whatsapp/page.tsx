import { Info } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { whatsappKinds } from "@/lib/whatsapp";
import { requirePermission } from "@/server/auth/page-guard";
import { getWhatsappSettings } from "@/server/whatsapp/queries";

import { WhatsappForm } from "./_components/whatsapp-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("whatsapp.settings");
  return { title: t("title") };
}

/** The gérant's WhatsApp Business number and notifications (CLAUDE.md §7 WhatsApp). */
export default async function WhatsappSettingsPage({
  params,
}: PageProps<"/[locale]/settings/whatsapp">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("organization:update");
  const { settings, webhookUrl, standIn } = await getWhatsappSettings(ctx);
  const t = await getTranslations("whatsapp.settings");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {standIn ? (
        <p
          className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900"
          data-testid="whatsapp-stand-in"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("standIn")}
        </p>
      ) : null}
      {settings ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("webhook")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("webhookHint")}</p>
          </CardHeader>
          <CardContent className="space-y-2 text-sm" data-testid="whatsapp-webhook">
            <div>
              <div className="text-muted-foreground">{t("webhookUrl")}</div>
              <code className="break-all" dir="ltr">
                {webhookUrl}
              </code>
            </div>
            <div>
              <div className="text-muted-foreground">{t("verifyToken")}</div>
              <code className="break-all" dir="ltr">
                {settings.verifyToken}
              </code>
            </div>
            {settings.hasAppSecret ? null : <p className="text-amber-800">{t("noAppSecret")}</p>}
          </CardContent>
        </Card>
      ) : null}
      <WhatsappForm
        saved={{ token: settings !== null, appSecret: settings?.hasAppSecret ?? false }}
        defaultValues={{
          enabled: settings?.enabled ?? false,
          phoneNumberId: settings?.phoneNumberId ?? "",
          businessAccountId: settings?.businessAccountId ?? "",
          accessToken: "",
          appSecret: "",
          language: settings?.language ?? "fr",
          notifications:
            settings?.notifications ??
            whatsappKinds.map((kind) => ({ kind, enabled: false, template: "" })),
        }}
      />
      <p className="text-sm text-muted-foreground">{t("help")}</p>
    </div>
  );
}
