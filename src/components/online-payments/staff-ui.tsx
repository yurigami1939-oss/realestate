"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { RefreshCw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { SearchInput } from "@/components/data-table/search-input";
import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { onlinePaymentStatuses } from "@/lib/online-payments";
import {
  recheckOnlinePaymentAction,
  refundOnlinePaymentAction,
} from "@/server/online-payments/actions";
import { refundOnlinePaymentSchema } from "@/server/online-payments/schemas";

const ALL = "__all__";

/** Status, « à traiter » and search (order number or payer), kept in the URL. */
export function OnlinePaymentFilters() {
  const t = useTranslations("onlinePayments");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={params.get("status") || ALL}
        onValueChange={(value) => params.set({ status: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-48" aria-label={t("filters.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.allStatuses")}</SelectItem>
          {onlinePaymentStatuses.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`status.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Checkbox
          id="issues"
          checked={params.get("issues") === "1"}
          onCheckedChange={(checked) => params.set({ issues: checked === true ? "1" : null })}
        />
        <Label htmlFor="issues" className="font-normal">
          {t("filters.issues")}
        </Label>
      </div>
      <SearchInput label={t("filters.search")} />
    </div>
  );
}

/** Asks SATIM again where a payment stands. */
export function RecheckOnlinePayment({ onlinePaymentId }: { onlinePaymentId: string }) {
  const t = useTranslations("onlinePayments");
  const recheck = useAction(recheckOnlinePaymentAction);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={recheck.pending}
      onClick={() =>
        recheck.run({ onlinePaymentId }, { onSuccess: () => toast.success(t("rechecked")) })
      }
    >
      <RefreshCw data-icon="inline-start" />
      {t("recheck")}
    </Button>
  );
}

type RefundValues = z.input<typeof refundOnlinePaymentSchema>;

/** Refund through SATIM; the payment and its receipt are cancelled with the reason. */
export function RefundOnlinePayment({
  onlinePaymentId,
  amount,
}: {
  onlinePaymentId: string;
  /** Formatted amount refunded. */
  amount: string;
}) {
  const t = useTranslations("onlinePayments.refund");
  const [open, setOpen] = useState(false);
  const refund = useAction(refundOnlinePaymentAction);
  const form = useForm<RefundValues, unknown, z.output<typeof refundOnlinePaymentSchema>>({
    resolver: zodResolver(refundOnlinePaymentSchema),
    defaultValues: { onlinePaymentId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <Undo2 data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description", { amount })}
      submitLabel={t("submit")}
      pending={refund.pending}
      destructive
      onSubmit={form.handleSubmit(() =>
        refund.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}
