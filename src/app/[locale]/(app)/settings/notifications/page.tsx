import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PushSettings } from "@/components/push/push-settings";
import { toLocale } from "@/i18n/locales";
import { requireTenantCtx } from "@/server/auth/page-guard";
import {
  removePushDeviceAction,
  subscribePushAction,
  testPushAction,
  unsubscribePushAction,
} from "@/server/push/actions";
import { listPushDevices } from "@/server/push/service";
import { vapidPublicKey } from "@/server/push/webpush";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("push.settings");
  return { title: t("title") };
}

/** The member's own push notifications: this device, and their other devices. */
export default async function NotificationsPage({
  params,
}: PageProps<"/[locale]/settings/notifications">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requireTenantCtx();
  const devices = await listPushDevices(ctx);
  const t = await getTranslations("push.settings");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <PushSettings
        publicKey={vapidPublicKey()}
        intro="staff"
        devices={devices}
        actions={{
          subscribe: subscribePushAction,
          unsubscribe: unsubscribePushAction,
          test: testPushAction,
          remove: removePushDeviceAction,
        }}
      />
    </div>
  );
}
