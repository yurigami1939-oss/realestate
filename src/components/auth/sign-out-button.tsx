"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { stopSupportSessionAction } from "@/server/console/actions";

/**
 * Stops this browser's push notifications (a shared device must not keep receiving the account's
 * notifications); the server forgets the device when its push service next answers « gone ».
 */
async function forgetPushSubscription() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Nothing to forget.
  }
}

/**
 * Signs out — or, in an operator's support session (CLAUDE.console.md §12), ends it (recorded in
 * both trails), giving the operator their own session back in the console.
 */
export function useSignOut({ support = false }: { support?: boolean } = {}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const signOut = () =>
    startTransition(async () => {
      if (support) {
        const ended = await stopSupportSessionAction();
        router.replace(ended.ok && ended.data.restored ? "/console" : "/sign-in");
        router.refresh();
        return;
      }
      await forgetPushSubscription();
      await authClient.signOut();
      router.replace("/sign-in");
      router.refresh();
    });
  return { signOut, pending };
}

export function SignOutButton() {
  const t = useTranslations("common");
  const { signOut, pending } = useSignOut();
  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={pending}>
      <LogOut data-icon="inline-start" className="rtl:rotate-180" />
      {t("signOut")}
    </Button>
  );
}
