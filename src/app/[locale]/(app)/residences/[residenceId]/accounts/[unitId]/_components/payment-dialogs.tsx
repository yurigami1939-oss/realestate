"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Banknote, CheckCircle2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { formatDZD } from "@/lib/money";
import { chargePaymentMethods } from "@/lib/residences";
import {
  cancelChargePaymentAction,
  clearChargeChequeAction,
  recordChargePaymentAction,
} from "@/server/charges/actions";
import {
  cancelChargePaymentSchema,
  clearChargeChequeSchema,
  recordChargePaymentSchema,
} from "@/server/charges/schemas";

type PaymentValues = z.input<typeof recordChargePaymentSchema>;

/** Cashier: charges paid for a unit; the receipt RCH- is issued with the payment. */
export function RecordChargePaymentDialog({
  residenceId,
  unitId,
  code,
  remaining,
  payerName,
  today,
}: {
  residenceId: string;
  unitId: string;
  code: string;
  remaining: bigint;
  payerName: string;
  today: string;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("charges.accounts");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const record = useAction(recordChargePaymentAction);
  const form = useForm<PaymentValues, unknown, z.output<typeof recordChargePaymentSchema>>({
    resolver: zodResolver(recordChargePaymentSchema),
    defaultValues: {
      residenceId,
      unitId,
      amount: "",
      method: "cash",
      paidOn: today,
      reference: "",
      bank: "",
      payerName,
      notes: "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Banknote data-icon="inline-start" />
          {t("record")}
        </Button>
      }
      title={tc("recordTitle", { code })}
      description={tc("recordHint", { amount: formatDZD(remaining, locale) })}
      submitLabel={t("record")}
      pending={record.pending}
      onSubmit={form.handleSubmit(() =>
        record.run(form.getValues(), {
          onSuccess: ({ receiptNumber }) => {
            toast.success(t("recorded", { number: receiptNumber }));
            form.reset();
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="amount"
        label={t("fields.amount")}
        inputMode="decimal"
        dir="ltr"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="method"
          label={t("fields.method")}
          options={chargePaymentMethods.map((m) => ({ value: m, label: t(`method.${m}`) }))}
        />
        <TextField
          control={form.control}
          name="paidOn"
          label={t("fields.paidOn")}
          type="date"
          dir="ltr"
          max={today}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="reference"
          label={t("fields.reference")}
          dir="ltr"
        />
        <TextField control={form.control} name="bank" label={t("fields.bank")} />
      </div>
      <TextField control={form.control} name="payerName" label={t("fields.payerName")} />
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

type CancelValues = z.input<typeof cancelChargePaymentSchema>;

/** Accountant: cancels a charge payment and its receipt with a reason (e.g. bounced cheque). */
export function CancelChargePaymentDialog({
  paymentId,
  receiptNumber,
}: {
  paymentId: string;
  receiptNumber: string;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("charges.accounts");
  const [open, setOpen] = useState(false);
  const cancel = useAction(cancelChargePaymentAction);
  const form = useForm<CancelValues, unknown, z.output<typeof cancelChargePaymentSchema>>({
    resolver: zodResolver(cancelChargePaymentSchema),
    defaultValues: { paymentId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <Ban data-icon="inline-start" />
          {t("cancel")}
        </Button>
      }
      title={t("cancelTitle", { number: receiptNumber })}
      description={tc("cancelDescription")}
      submitLabel={t("cancel")}
      destructive
      pending={cancel.pending}
      onSubmit={form.handleSubmit(() =>
        cancel.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("cancelDone"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("cancelReason")} rows={2} />
    </FormDialog>
  );
}

type ClearValues = z.input<typeof clearChargeChequeSchema>;

/** Cashier: the bank cleared a cheque received « sous réserve d'encaissement ». */
export function ClearChargeChequeDialog({
  paymentId,
  today,
}: {
  paymentId: string;
  today: string;
}) {
  const t = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const clear = useAction(clearChargeChequeAction);
  const form = useForm<ClearValues, unknown, z.output<typeof clearChargeChequeSchema>>({
    resolver: zodResolver(clearChargeChequeSchema),
    defaultValues: { paymentId, clearedOn: today },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <CheckCircle2 data-icon="inline-start" />
          {t("clear")}
        </Button>
      }
      title={t("clearTitle")}
      submitLabel={t("clear")}
      pending={clear.pending}
      onSubmit={form.handleSubmit(() =>
        clear.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("cleared"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="clearedOn"
        label={t("clearedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
    </FormDialog>
  );
}
