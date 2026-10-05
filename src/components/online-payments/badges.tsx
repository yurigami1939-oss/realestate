import { useTranslations } from "next-intl";

import type { OnlinePaymentStatus } from "@/lib/online-payments";
import { cn } from "@/lib/utils";

const badge =
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const statusClasses: Record<OnlinePaymentStatus, string> = {
  created: "border-zinc-200 bg-zinc-50 text-zinc-600",
  pending: "border-amber-300 bg-amber-50 text-amber-900",
  paid: "border-emerald-300 bg-emerald-50 text-emerald-900",
  failed: "border-red-300 bg-red-50 text-red-900",
  expired: "border-zinc-300 bg-zinc-100 text-zinc-700",
  refunded: "border-sky-200 bg-sky-50 text-sky-900",
};

export function OnlinePaymentStatusBadge({ status }: { status: OnlinePaymentStatus }) {
  const t = useTranslations("onlinePayments.status");
  return <span className={cn(badge, statusClasses[status])}>{t(status)}</span>;
}

/** The cards accepted (CIB, Edahabia), as SATIM asks merchants to show them. */
export function CardsMark({ className }: { className?: string }) {
  const t = useTranslations("portal.pay");
  return (
    <span
      className={cn(badge, "border-emerald-700 bg-emerald-700 text-white", className)}
      dir="ltr"
    >
      {t("cards")}
    </span>
  );
}

/** Payments made on SATIM's test platform: no real debit. */
export function TestModeBadge() {
  const t = useTranslations("onlinePayments");
  return (
    <span className={cn(badge, "border-violet-300 bg-violet-50 text-violet-900")}>
      {t("testMode")}
    </span>
  );
}
