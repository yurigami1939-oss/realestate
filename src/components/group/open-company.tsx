"use client";

import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

/** Makes a company of the group the active one, then opens its dashboard. */
export function OpenCompanyButton({ organizationId }: { organizationId: string }) {
  const t = useTranslations("group");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.organization.setActive({ organizationId });
          router.replace("/dashboard");
          router.refresh();
        })
      }
    >
      <ArrowRightLeft data-icon="inline-start" />
      {t("open")}
    </Button>
  );
}
