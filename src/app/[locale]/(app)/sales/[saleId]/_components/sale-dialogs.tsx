"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Banknote, CircleCheck, FileSignature, Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type FormEventHandler, type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { formatDZD } from "@/lib/money";
import { paymentMethods } from "@/lib/sales";
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

function FormDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  submitLabel,
  pending,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}) {
  const tc = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <FieldGroup>{children}</FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type PaymentValues = z.input<typeof recordPaymentSchema>;

/** Cashier: records money received on the sale; the receipt is issued with it. */
export function RecordPaymentDialog({
  reservationId,
  number,
  remaining,
  payerName,
  today,
}: {
  reservationId: string;
  number: string;
  remaining: bigint;
  payerName: string;
  today: string;
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
          options={paymentMethods.map((m) => ({ value: m, label: t(`method.${m}`) }))}
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
        <TextField control={form.control} name="reference" label={t("fields.reference")} dir="ltr" />
        <TextField control={form.control} name="bank" label={t("fields.bank")} />
      </div>
      <TextField control={form.control} name="payerName" label={t("fields.payerName")} />
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

/** Notary and reference of the reservation contract. */
export function ContractDialog({
  reservationId,
  notary,
  reference,
}: {
  reservationId: string;
  notary: string | null;
  reference: string | null;
}) {
  const t = useTranslations("sales");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const save = useAction(updateReservationContractAction);
  const form = useForm<ContractValues, unknown, z.output<typeof reservationContractSchema>>({
    resolver: zodResolver(reservationContractSchema),
    defaultValues: { reservationId, notary: notary ?? "", reference: reference ?? "" },
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
    </FormDialog>
  );
}
