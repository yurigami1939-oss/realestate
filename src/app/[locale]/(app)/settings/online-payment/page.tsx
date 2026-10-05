import { Info } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { CardsMark } from "@/components/online-payments/badges";
import { toLocale } from "@/i18n/locales";
import { SATIM_HELP_NUMBER } from "@/lib/online-payments";
import { requirePermission } from "@/server/auth/page-guard";
import { getGatewaySettings } from "@/server/online-payments/queries";

import { GatewayForm } from "./_components/gateway-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onlinePayments.settings");
  return { title: t("title") };
}

/** The gérant's SATIM merchant account (CLAUDE.md §7 Online payment). */
export default async function OnlinePaymentSettingsPage({
  params,
}: PageProps<"/[locale]/settings/online-payment">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("organization:update");
  const { settings, testIsStandIn } = await getGatewaySettings(ctx);
  const t = await getTranslations("onlinePayments.settings");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-wrap items-center gap-2">
        <CardsMark />
        <span className="text-sm text-muted-foreground">
          {t("helpLine", { number: SATIM_HELP_NUMBER })}
        </span>
      </div>
      {testIsStandIn ? (
        <p
          className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900"
          data-testid="satim-stand-in"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("standIn")}
        </p>
      ) : null}
      <GatewayForm
        hasPassword={settings !== null}
        defaultValues={{
          enabled: settings?.enabled ?? false,
          environment: settings?.environment ?? "test",
          username: settings?.username ?? "",
          password: "",
          terminalId: settings?.terminalId ?? "",
          salesEnabled: settings?.salesEnabled ?? true,
          chargesEnabled: settings?.chargesEnabled ?? true,
        }}
      />
      <p className="text-sm text-muted-foreground">{t("help")}</p>
    </div>
  );
}
