"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Banknote, CheckCircle2, DoorOpen, HandCoins, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { type FieldValues, type UseFormReturn, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { AccountField, type AccountOption } from "@/components/treasury/account-field";
import { Button } from "@/components/ui/button";
import { formatDZD } from "@/lib/money";
import { rentFrequencies, type RentPaymentKind, rentPaymentMethods } from "@/lib/rentals";
import type { AppErrorShape } from "@/lib/result";
import {
  cancelRentPaymentAction,
  clearRentChequeAction,
  endLeaseAction,
  recordRentPaymentAction,
  renewLeaseAction,
  settleDepositAction,
} from "@/server/rentals/actions";
import {
  cancelRentPaymentSchema,
  clearRentChequeSchema,
  endLeaseSchema,
  recordRentPaymentSchema,
  renewLeaseSchema,
  settleDepositSchema,
} from "@/server/rentals/schemas";

/** Field errors from the server land on the form; other errors are toasted. */
const fieldErrors =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any context/output types
  <T extends FieldValues>(form: UseFormReturn<T, any, any>) =>
    (error: AppErrorShape) =>
      applyFieldErrors(form, error);

type PaymentValues = z.input<typeof recordRentPaymentSchema>;

/** Cashier: rent (quittance) or the deposit; the receipt QIT- is issued with the payment. */
export function RecordRentPaymentDialog({
  leaseId,
  kind,
  max,
  payerName,
  today,
  accounts,
}: {
  leaseId: string;
  kind: RentPaymentKind;
  /** What remains to pay (rent) or what is missing of the deposit. */
  max: bigint;
  payerName: string;
  today: string;
  /** Cash desks and accounts the payment may land on. */
  accounts: AccountOption[];
}) {
  const t = useTranslations("rentals.payment");
  const tp = useTranslations("payments");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const record = useAction(recordRentPaymentAction);
  const form = useForm<PaymentValues, unknown, z.output<typeof recordRentPaymentSchema>>({
    resolver: zodResolver(recordRentPaymentSchema),
    defaultValues: {
      leaseId,
      kind,
      amount: "",
      method: "cash",
      paidOn: today,
      reference: "",
      bank: "",
      payerName,
      notes: "",
      accountId: "",
    },
  });
  const method = useWatch({ control: form.control, name: "method" });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant={kind === "rent" ? "default" : "outline"}>
          {kind === "rent" ? (
            <Banknote data-icon="inline-start" />
          ) : (
            <HandCoins data-icon="inline-start" />
          )}
          {t(`open.${kind}`)}
        </Button>
      }
      title={t(`title.${kind}`)}
      description={t(`hint.${kind}`, { amount: formatDZD(max, locale) })}
      submitLabel={t(`open.${kind}`)}
      pending={record.pending}
      onSubmit={form.handleSubmit(() =>
        record.run(form.getValues(), {
          onSuccess: ({ receiptNumber }) => {
            toast.success(tp("recorded", { number: receiptNumber }));
            form.reset();
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="amount"
        label={tp("fields.amount")}
        inputMode="decimal"
        dir="ltr"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="method"
          label={tp("fields.method")}
          options={rentPaymentMethods.map((m) => ({ value: m, label: tp(`method.${m}`) }))}
        />
        <TextField
          control={form.control}
          name="paidOn"
          label={tp("fields.paidOn")}
          type="date"
          dir="ltr"
          max={today}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="reference"
          label={tp("fields.reference")}
          dir="ltr"
        />
        <TextField control={form.control} name="bank" label={tp("fields.bank")} />
      </div>
      <TextField control={form.control} name="payerName" label={tp("fields.payerName")} />
      <AccountField control={form.control} name="accountId" method={method} accounts={accounts} />
      <TextareaField control={form.control} name="notes" label={tp("fields.notes")} rows={2} />
    </FormDialog>
  );
}

type CancelValues = z.input<typeof cancelRentPaymentSchema>;

/** Accountant: cancels a payment and its receipt with a reason (e.g. bounced cheque). */
export function CancelRentPaymentDialog({
  paymentId,
  receiptNumber,
}: {
  paymentId: string;
  receiptNumber: string;
}) {
  const t = useTranslations("rentals.payment");
  const tp = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const cancel = useAction(cancelRentPaymentAction);
  const form = useForm<CancelValues, unknown, z.output<typeof cancelRentPaymentSchema>>({
    resolver: zodResolver(cancelRentPaymentSchema),
    defaultValues: { paymentId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm" aria-label={t("cancelLabel", { number: receiptNumber })}>
          <Ban data-icon="inline-start" />
          {tp("cancel")}
        </Button>
      }
      title={tp("cancelTitle", { number: receiptNumber })}
      description={tp("cancelDescription")}
      submitLabel={tp("cancel")}
      pending={cancel.pending}
      destructive
      onSubmit={form.handleSubmit(() =>
        cancel.run(form.getValues(), {
          onSuccess: () => {
            toast.success(tp("cancelDone"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={tp("cancelReason")} rows={2} />
    </FormDialog>
  );
}

type ClearValues = z.input<typeof clearRentChequeSchema>;

/** Cashier: the day the bank cleared a cheque. */
export function ClearRentChequeDialog({ paymentId, today }: { paymentId: string; today: string }) {
  const t = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const clear = useAction(clearRentChequeAction);
  const form = useForm<ClearValues, unknown, z.output<typeof clearRentChequeSchema>>({
    resolver: zodResolver(clearRentChequeSchema),
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
          onError: fieldErrors(form),
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

type EndValues = z.input<typeof endLeaseSchema>;

/** The tenant leaves: the unit is available again, the periods not started are dropped. */
export function EndLeaseDialog({ leaseId, today }: { leaseId: string; today: string }) {
  const t = useTranslations("rentals.end");
  const [open, setOpen] = useState(false);
  const end = useAction(endLeaseAction);
  const form = useForm<EndValues, unknown, z.output<typeof endLeaseSchema>>({
    resolver: zodResolver(endLeaseSchema),
    defaultValues: { leaseId, endedOn: today, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <DoorOpen data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      pending={end.pending}
      destructive
      onSubmit={form.handleSubmit(() =>
        end.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="endedOn"
        label={t("date")}
        type="date"
        dir="ltr"
        max={today}
      />
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}

type RenewValues = z.input<typeof renewLeaseSchema>;

/** A new lease for the same tenant from the day after the term; the deposit carries over. */
export function RenewLeaseDialog({
  leaseId,
  defaults,
  startOn,
  today,
}: {
  leaseId: string;
  /** The current terms, as form values. */
  defaults: Omit<RenewValues, "leaseId" | "signedOn" | "notes">;
  /** First day of the renewal, formatted. */
  startOn: string;
  today: string;
}) {
  const t = useTranslations("rentals.renew");
  const tf = useTranslations("rentals");
  const [open, setOpen] = useState(false);
  const renew = useAction(renewLeaseAction);
  const form = useForm<RenewValues, unknown, z.output<typeof renewLeaseSchema>>({
    resolver: zodResolver(renewLeaseSchema),
    defaultValues: { leaseId, signedOn: today, notes: "", ...defaults },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <RefreshCw data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description", { date: startOn })}
      submitLabel={t("submit")}
      pending={renew.pending}
      onSubmit={form.handleSubmit(() =>
        renew.run(form.getValues(), {
          onSuccess: ({ number }) => {
            toast.success(t("done", { number }));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="signedOn"
          label={tf("fields.signedOn")}
          type="date"
          dir="ltr"
          max={today}
        />
        <TextField
          control={form.control}
          name="durationMonths"
          label={tf("fields.durationMonths")}
          inputMode="numeric"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="monthlyRent"
          label={tf("fields.monthlyRent")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="monthlyCharges"
          label={tf("fields.monthlyCharges")}
          inputMode="decimal"
          dir="ltr"
        />
        <SelectField
          control={form.control}
          name="frequency"
          label={tf("fields.frequency")}
          options={rentFrequencies.map((f) => ({ value: f, label: tf(`frequency.${f}`) }))}
        />
        <TextField
          control={form.control}
          name="deposit"
          label={tf("fields.deposit")}
          inputMode="decimal"
          dir="ltr"
        />
      </div>
      <TextareaField control={form.control} name="notes" label={tf("fields.notes")} rows={2} />
    </FormDialog>
  );
}

type SettleValues = z.input<typeof settleDepositSchema>;

/** What is given back of the deposit; the rest is kept with the reason. Final. */
export function SettleDepositDialog({
  leaseId,
  held,
  today,
}: {
  leaseId: string;
  /** Deposit held, typed form value (« 90000,00 »). */
  held: string;
  today: string;
}) {
  const t = useTranslations("rentals.deposit");
  const [open, setOpen] = useState(false);
  const settle = useAction(settleDepositAction);
  const form = useForm<SettleValues, unknown, z.output<typeof settleDepositSchema>>({
    resolver: zodResolver(settleDepositSchema),
    defaultValues: { leaseId, settledOn: today, refunded: held, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <HandCoins data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      pending={settle.pending}
      onSubmit={form.handleSubmit(() =>
        settle.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="settledOn"
          label={t("date")}
          type="date"
          dir="ltr"
          max={today}
        />
        <TextField
          control={form.control}
          name="refunded"
          label={t("refunded")}
          inputMode="decimal"
          dir="ltr"
        />
      </div>
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}
