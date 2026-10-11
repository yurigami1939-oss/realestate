import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PushSettings } from "@/components/push/push-settings";
import { toLocale } from "@/i18n/locales";
import { requirePortalCtx } from "@/server/portal/page-guard";
import {
  removePortalPushDeviceAction,
  subscribePortalPushAction,
  testPortalPushAction,
  unsubscribePortalPushAction,
} from "@/server/push/actions";
import { listPushDevices } from "@/server/push/service";
import { vapidPublicKey } from "@/server/push/webpush";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("push.settings");
  return { title: t("title") };
}

/** A buyer's, co-owner's or tenant's push notifications on their phone. */
export default async function PortalNotificationsPage({
  params,
}: PageProps<"/[locale]/portal/notifications">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePortalCtx();
  const devices = await listPushDevices(ctx);
  const t = await getTranslations("push.settings");
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-large-title">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <PushSettings
        publicKey={vapidPublicKey()}
        intro="portal"
        devices={devices}
        actions={{
          subscribe: subscribePortalPushAction,
          unsubscribe: unsubscribePortalPushAction,
          test: testPortalPushAction,
          remove: removePortalPushDeviceAction,
        }}
      />
    </div>
  );
}
