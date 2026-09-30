"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function useSignOut() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const signOut = () =>
    startTransition(async () => {
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
