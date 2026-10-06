"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Banknote, CircleCheck, FileSignature, Mail, Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { FormDialog } from "@/components/forms/form-dialog";
import { AccountField, type AccountOption } from "@/components/treasury/account-field";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { formatDZD } from "@/lib/money";
import { counterPaymentMethods } from "@/lib/sales";
import { issueReminderAction } from "@/server/collections/actions";
import { issueReminderSchema } from "@/server/collections/schemas";
import {
  cancelPaymentAction,
  clearChequeAction,
  recordPaymentAction,
} from "@/server/payments/actions";
import {
  cancelPaymentSchema,
  clearChequeSchema,
  recordPaymentSchema,
} from "@/server/payments/schemas";
import { recordSaleAction, updateReservationContractAction } from "@/server/sales/actions";
import { recordSaleSchema, reservationContractSchema } from "@/server/sales/schemas";

type PaymentValues = z.input<typeof recordPaymentSchema>;

/** Cashier: records money received on the sale; the receipt is issued with it. */
export function RecordPaymentDialog({
  reservationId,
  number,
  remaining,
  payerName,
  today,
  accounts,
}: {
  reservationId: string;
  number: string;
  remaining: bigint;
  payerName: string;
  today: string;
  /** Cash desks and accounts the payment may land on. */
  accounts: AccountOption[];
}) {
  const t = useTranslations("payments");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const record = useAction(recordPaymentAction);
  const form = useForm<PaymentValues, unknown, z.output<typeof recordPaymentSchema>>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      reservationId,
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
        <Button>
          <Banknote data-icon="inline-start" />
          {t("record")}
        </Button>
      }
      title={t("recordTitle", { number })}
      description={t("remainingHint", { amount: formatDZD(remaining, locale) })}
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
          options={counterPaymentMethods.map((m) => ({ value: m, label: t(`method.${m}`) }))}
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
      <AccountField control={form.control} name="accountId" method={method} accounts={accounts} />
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

type CancelValues = z.input<typeof cancelPaymentSchema>;

/** Accountant: cancels a payment and its receipt with a reason (e.g. bounced cheque). */
export function CancelPaymentDialog({
  paymentId,
  receiptNumber,
}: {
  paymentId: string;
  receiptNumber: string;
}) {
  const t = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const cancel = useAction(cancelPaymentAction);
  const form = useForm<CancelValues, unknown, z.output<typeof cancelPaymentSchema>>({
    resolver: zodResolver(cancelPaymentSchema),
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
      description={t("cancelDescription")}
      submitLabel={t("cancel")}
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

type ClearValues = z.input<typeof clearChequeSchema>;

/** Cashier: the bank cleared a cheque received « sous réserve d'encaissement ». */
export function ClearChequeDialog({ paymentId, today }: { paymentId: string; today: string }) {
  const t = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const clear = useAction(clearChequeAction);
  const form = useForm<ClearValues, unknown, z.output<typeof clearChequeSchema>>({
    resolver: zodResolver(clearChequeSchema),
    defaultValues: { paymentId, clearedOn: today },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <CircleCheck data-icon="inline-start" />
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

type SaleValues = z.input<typeof recordSaleSchema>;

/** Manager: the VSP deed was signed at the notary. */
export function RecordSaleDialog({
  reservationId,
  notary,
  today,
}: {
  reservationId: string;
  notary: string;
  today: string;
}) {
  const t = useTranslations("sales.vsp");
  const [open, setOpen] = useState(false);
  const record = useAction(recordSaleAction);
  const form = useForm<SaleValues, unknown, z.output<typeof recordSaleSchema>>({
    resolver: zodResolver(recordSaleSchema),
    defaultValues: { reservationId, signedOn: today, notary, reference: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <FileSignature data-icon="inline-start" />
          {t("record")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={t("record")}
      pending={record.pending}
      onSubmit={form.handleSubmit(() =>
        record.run(form.getValues(), {
          onSuccess: ({ saleNumber }) => {
            toast.success(t("recorded", { number: saleNumber }));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="signedOn"
        label={t("signedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
      <TextField control={form.control} name="notary" label={t("notary")} />
      <TextField control={form.control} name="reference" label={t("reference")} />
    </FormDialog>
  );
}

type ContractValues = z.input<typeof reservationContractSchema>;

/**
 * Notary and reference of the reservation contract, the contractual delivery date and the
 * FGCMPI guarantee certificate.
 */
export function ContractDialog({
  reservationId,
  notary,
  reference,
  deliveryDueOn,
  guaranteeNumber,
  guaranteeIssuedOn,
}: {
  reservationId: string;
  notary: string | null;
  reference: string | null;
  deliveryDueOn: string | null;
  guaranteeNumber: string | null;
  guaranteeIssuedOn: string | null;
}) {
  const t = useTranslations("sales");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const save = useAction(updateReservationContractAction);
  const form = useForm<ContractValues, unknown, z.output<typeof reservationContractSchema>>({
    resolver: zodResolver(reservationContractSchema),
    defaultValues: {
      reservationId,
      notary: notary ?? "",
      reference: reference ?? "",
      deliveryDueOn: deliveryDueOn ?? "",
      guaranteeNumber: guaranteeNumber ?? "",
      guaranteeIssuedOn: guaranteeIssuedOn ?? "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <Pencil data-icon="inline-start" />
          {tc("edit")}
        </Button>
      }
      title={t("contract.title")}
      submitLabel={tc("save")}
      pending={save.pending}
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("contract.saved"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="notary" label={t("fields.notary")} />
      <TextField control={form.control} name="reference" label={t("fields.reference")} />
      <TextField
        control={form.control}
        name="deliveryDueOn"
        label={t("fields.deliveryDueOn")}
        type="date"
        dir="ltr"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="guaranteeNumber"
          label={t("fields.guaranteeNumber")}
        />
        <TextField
          control={form.control}
          name="guaranteeIssuedOn"
          label={t("fields.guaranteeIssuedOn")}
          type="date"
          dir="ltr"
        />
      </div>
    </FormDialog>
  );
}

type ReminderValues = z.input<typeof issueReminderSchema>;

/** Prepares a bilingual reminder letter for the overdue installments (PDF by the worker). */
export function ReminderDialog({
  reservationId,
  overdue,
  payBy,
  today,
}: {
  reservationId: string;
  overdue: bigint;
  payBy: string;
  today: string;
}) {
  const t = useTranslations("collections.reminder");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const issue = useAction(issueReminderAction);
  const form = useForm<ReminderValues, unknown, z.output<typeof issueReminderSchema>>({
    resolver: zodResolver(issueReminderSchema),
    defaultValues: { reservationId, payBy },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Mail data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description", { amount: formatDZD(overdue, locale) })}
      submitLabel={t("submit")}
      pending={issue.pending}
      onSubmit={form.handleSubmit(() =>
        issue.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("issued"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="payBy"
        label={t("payBy")}
        type="date"
        dir="ltr"
        min={today}
      />
    </FormDialog>
  );
}
