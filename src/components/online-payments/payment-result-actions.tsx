"use client";

import { Printer, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { refreshOnlinePaymentAction } from "@/server/online-payments/portal-actions";

/** Asks the gateway again (payment still being checked) or reloads (receipt being rendered). */
export function RefreshOnlinePayment({
  onlinePaymentId,
  ask,
}: {
  onlinePaymentId: string;
  /** Ask the gateway (pending payment) rather than only reloading the page. */
  ask: boolean;
}) {
  const t = useTranslations("portal.pay.result");
  const router = useRouter();
  const refresh = useAction(refreshOnlinePaymentAction);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={refresh.pending}
      onClick={() =>
        ask
          ? refresh.run({ onlinePaymentId }, { onSuccess: () => router.refresh() })
          : router.refresh()
      }
    >
      <RefreshCw data-icon="inline-start" />
      {t("refresh")}
    </Button>
  );
}

/** Prints the result page: the proof of payment SATIM asks merchants to offer. */
export function PrintPage() {
  const t = useTranslations("portal.pay.result");
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer data-icon="inline-start" />
      {t("print")}
    </Button>
  );
}
