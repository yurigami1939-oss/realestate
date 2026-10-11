import { useTranslations } from "next-intl";

import type { OnlinePaymentStatus } from "@/lib/online-payments";
import { cn } from "@/lib/utils";

const badge =
  "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap";

const statusClasses: Record<OnlinePaymentStatus, string> = {
  created: "border-border bg-muted text-muted-foreground",
  pending: "border-warning/25 bg-warning-soft text-warning",
  paid: "border-success/25 bg-success-soft text-success",
  failed: "border-danger/25 bg-danger-soft text-danger",
  expired: "border-border bg-muted text-muted-foreground",
  refunded: "border-info/25 bg-info-soft text-info",
};

export function OnlinePaymentStatusBadge({ status }: { status: OnlinePaymentStatus }) {
  const t = useTranslations("onlinePayments.status");
  return <span className={cn(badge, statusClasses[status])}>{t(status)}</span>;
}

/** The cards accepted (CIB, Edahabia), as SATIM asks merchants to show them. */
export function CardsMark({ className }: { className?: string }) {
  const t = useTranslations("portal.pay");
  return (
    <span className={cn(badge, "border-success bg-success-vivid text-white", className)} dir="ltr">
      {t("cards")}
    </span>
  );
}

/** Payments made on SATIM's test platform: no real debit. */
export function TestModeBadge() {
  const t = useTranslations("onlinePayments");
  return (
    <span className={cn(badge, "border-purple/25 bg-purple-soft text-purple")}>
      {t("testMode")}
    </span>
  );
}
