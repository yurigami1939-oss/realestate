"use client";

import { Bell, BellOff, Send, Smartphone, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/i18n/navigation";
import { formatDate } from "@/lib/dates";
import { deviceLabel } from "@/lib/push";
import type { Result } from "@/lib/result";

type Status = "loading" | "unsupported" | "ios" | "denied" | "off" | "on";

type SubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: "fr" | "ar";
  userAgent?: string;
};

export type PushDevice = {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: Date;
  lastSentAt: Date | null;
};

type Props = {
  /** The application server's VAPID key (base64url). */
  publicKey: string;
  intro: "staff" | "portal";
  devices: PushDevice[];
  actions: {
    subscribe: (input: SubscriptionInput) => Promise<Result<{ id: string }>>;
    unsubscribe: (input: { endpoint: string }) => Promise<Result<void>>;
    test: (input: { endpoint: string }) => Promise<Result<void>>;
    remove: (input: { subscriptionId: string }) => Promise<Result<void>>;
  };
};

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches;

/** Where this browser stands: able to receive, allowed, subscribed (and to which endpoint). */
async function readStatus(): Promise<{ status: Status; endpoint: string | null }> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return { status: isIos() && !standalone() ? "ios" : "unsupported", endpoint: null };
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  const subscription = await registration.pushManager.getSubscription();
  if (Notification.permission === "denied") return { status: "denied", endpoint: null };
  return subscription
    ? { status: "on", endpoint: subscription.endpoint }
    : { status: "off", endpoint: null };
}

/** The VAPID key as the bytes `pushManager.subscribe` expects. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Push notifications on this device (CLAUDE.md §7 Push notifications): turned on with the
 * browser's permission and a subscription to its push service (kept by the server in the page's
 * language), a test notification, and the account's other devices, each removable.
 */
export function PushSettings({ publicKey, intro, devices, actions }: Props) {
  const t = useTranslations("push.settings");
  const te = useTranslations("push.errors");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const subscribe = useAction(actions.subscribe);
  const unsubscribe = useAction(actions.unsubscribe);
  const test = useAction(actions.test);
  const remove = useAction(actions.remove);

  useEffect(() => {
    let cancelled = false;
    void readStatus()
      .catch(() => ({ status: "unsupported" as const, endpoint: null }))
      .then((read) => {
        if (cancelled) return;
        setStatus(read.status);
        setEndpoint(read.endpoint);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const json = subscription.toJSON();
      await subscribe.run(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
          locale,
          userAgent: navigator.userAgent.slice(0, 300),
        },
        {
          onSuccess: () => {
            setStatus("on");
            setEndpoint(subscription.endpoint);
            toast.success(t("enabled"));
            router.refresh();
          },
        },
      );
    } catch {
      toast.error(te("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      const current = subscription?.endpoint ?? endpoint;
      await subscription?.unsubscribe();
      if (current) await unsubscribe.run({ endpoint: current });
      setStatus("off");
      setEndpoint(null);
      toast.success(t("disabled"));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const pending = busy || subscribe.pending || unsubscribe.pending;
  const hint =
    status === "unsupported"
      ? t("unsupported")
      : status === "ios"
        ? t("iosHint")
        : status === "denied"
          ? t("denied")
          : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === "on" ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            {t("title")}
            {status === "on" || status === "off" ? (
              <Badge variant={status === "on" ? "default" : "secondary"} data-push-status={status}>
                {status === "on" ? t("on") : t("off")}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {intro === "staff" ? t("staffIntro") : t("portalIntro")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
          <div className="flex flex-wrap gap-2">
            {status === "off" || status === "denied" ? (
              <Button onClick={() => void enable()} disabled={pending || status === "denied"}>
                <Bell data-icon="inline-start" />
                {t("enable")}
              </Button>
            ) : null}
            {status === "on" && endpoint ? (
              <>
                <Button
                  variant="outline"
                  disabled={test.pending}
                  onClick={() =>
                    void test.run({ endpoint }, { onSuccess: () => toast.success(t("testSent")) })
                  }
                >
                  <Send data-icon="inline-start" className="rtl:rotate-180" />
                  {t("test")}
                </Button>
                <Button variant="ghost" onClick={() => void disable()} disabled={pending}>
                  <BellOff data-icon="inline-start" />
                  {t("disable")}
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("devices")}</CardTitle>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDevices")}</p>
          ) : (
            <ul className="divide-y">
              {devices.map((device) => (
                <li key={device.id} className="flex items-center gap-3 py-3">
                  <Smartphone className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span dir="ltr">{deviceLabel(device.userAgent) ?? t("device")}</span>
                      {device.endpoint === endpoint ? (
                        <Badge variant="outline">{t("thisDevice")}</Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("since", { date: formatDate(device.createdAt) })} ·{" "}
                      {device.lastSentAt
                        ? t("lastSent", { date: formatDate(device.lastSentAt) })
                        : t("never")}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.pending}
                    onClick={() =>
                      void remove.run(
                        { subscriptionId: device.id },
                        {
                          onSuccess: () => {
                            if (device.endpoint === endpoint) {
                              setStatus("off");
                              setEndpoint(null);
                            }
                            toast.success(t("removed"));
                            router.refresh();
                          },
                        },
                      )
                    }
                  >
                    <Trash2 data-icon="inline-start" />
                    {t("remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
