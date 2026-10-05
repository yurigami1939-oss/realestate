"use client";

import { FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useTranslateKey } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { issuePortalStatementAction } from "@/server/certificates/portal-actions";

/** Portal: draws the buyer's statement of account (the same day's one when nothing changed). */
export function PortalStatementButton({ reservationId }: { reservationId: string }) {
  const t = useTranslations("portal.sale");
  const translate = useTranslateKey();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const result = await issuePortalStatementAction({ reservationId });
          if (!result.ok) {
            toast.error(translate(result.error.messageKey));
            return;
          }
          toast.success(t("statementReady"));
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? (
        <Loader2 className="animate-spin" data-icon="inline-start" />
      ) : (
        <FileText data-icon="inline-start" />
      )}
      {t("statement")}
    </Button>
  );
}
