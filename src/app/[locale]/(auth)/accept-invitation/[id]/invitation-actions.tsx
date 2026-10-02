"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function InvitationActions({ invitationId }: { invitationId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    startTransition(async () => {
      const { data, error: authError } = await authClient.organization.acceptInvitation({
        invitationId,
      });
      if (authError || !data) {
        setError(t("invitation.invalid"));
        return;
      }
      await authClient.organization.setActive({ organizationId: data.member.organizationId });
      router.replace("/dashboard");
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      await authClient.organization.rejectInvitation({ invitationId });
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <FormAlert message={error} />
      <div className="flex gap-2">
        <Button onClick={accept} disabled={pending}>
          {t("invitation.accept")}
        </Button>
        <Button variant="ghost" onClick={reject} disabled={pending}>
          {t("invitation.reject")}
        </Button>
      </div>
    </div>
  );
}
