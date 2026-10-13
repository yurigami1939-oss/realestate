import { useTranslations } from "next-intl";

import type { InvoiceState } from "@/lib/billing";
import { cn } from "@/lib/utils";

const classes: Record<InvoiceState, string> = {
  due: "border-info/25 bg-info-soft text-info",
  overdue: "border-danger/25 bg-danger-soft text-danger",
  paid: "border-success/25 bg-success-soft text-success",
  credited: "border-border bg-muted text-muted-foreground",
};

/** The derived state of an operator invoice (CLAUDE.console.md §11) as a capsule. */
export function InvoiceStateBadge({ state }: { state: InvoiceState }) {
  const t = useTranslations("subscription.invoices.states");
  return (
    <span
      data-state={state}
      className={cn(
        "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        classes[state],
      )}
    >
      {t(state)}
    </span>
  );
}
