"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, CheckCheck, FilePlus2, HandCoins, Pencil, Plus, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { AccountField, type AccountOption } from "@/components/treasury/account-field";
import { Button } from "@/components/ui/button";
import { costCategories, costPaymentMethods, invoiceSplit } from "@/lib/costs";
import { formatDZD, parseDZD } from "@/lib/money";
import {
  acceptContractAction,
  createContractAction,
  createContractorAction,
  payWorksInvoiceAction,
  recordWorksInvoiceAction,
  releaseRetentionAction,
  terminateContractAction,
  updateContractAction,
  updateWorksInvoiceAction,
} from "@/server/costs/actions";
import {
  acceptContractSchema,
  contractFormSchema,
  createContractorSchema,
  payWorksInvoiceSchema,
  releaseRetentionSchema,
  terminateContractSchema,
  worksInvoiceFormSchema,
} from "@/server/costs/schemas";

const useMoney = () => {
  const locale = useLocale() === "ar" ? "ar" : "fr";
  return (v: bigint) => formatDZD(v, locale);
};

/** A contractor or design office not known yet. */
export function ContractorDialog() {
  const t = useTranslations("costs");
  const [open, setOpen] = useState(false);
  const create = useAction(createContractorAction);
  const form = useForm<
    z.input<typeof createContractorSchema>,
    unknown,
    z.output<typeof createContractorSchema>
  >({
    resolver: zodResolver(createContractorSchema),
    defaultValues: { name: "", activity: "", nif: "", rib: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Plus data-icon="inline-start" />
          {t("contractors.create")}
        </Button>
      }
      title={t("contractors.createTitle")}
      submitLabel={t("contractors.create")}
      pending={create.pending}
      onSubmit={form.handleSubmit(() =>
        create.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("contractors.created"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="name" label={t("contractors.name")} />
      <TextField control={form.control} name="activity" label={t("contractors.activity")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="nif" label={t("contractors.nif")} dir="ltr" />
        <TextField control={form.control} name="rib" label={t("contractors.rib")} dir="ltr" />
      </div>
    </FormDialog>
  );
}

type ContractValues = {
  supplierId: string;
  category: (typeof costCategories)[number];
  reference: string;
  title: string;
  amount: string;
  retention: string;
  signedOn: string;
  plannedEndOn: string;
  notes: string;
};

/** A contract with a contractor: new (`projectId`) or corrected (`contractId` and values). */
export function ContractDialog(
  props: {
    contractors: { id: string; name: string }[];
    today: string;
  } & (
    | { projectId: string; contractId?: undefined; values?: undefined }
    | { projectId?: undefined; contractId: string; values: ContractValues }
  ),
) {
  const t = useTranslations("costs");
  const tc = useTranslations("common");
  const editing = props.contractId !== undefined;
  const [open, setOpen] = useState(false);
  const create = useAction(createContractAction);
  const update = useAction(updateContractAction);
  const defaults: ContractValues = props.values ?? {
    supplierId: props.contractors[0]?.id ?? "",
    category: "works",
    reference: "",
    title: "",
    amount: "",
    retention: "5",
    signedOn: props.today,
    plannedEndOn: "",
    notes: "",
  };
  const form = useForm<
    z.input<typeof contractFormSchema>,
    unknown,
    z.output<typeof contractFormSchema>
  >({
    resolver: zodResolver(contractFormSchema),
    defaultValues: { targetId: props.contractId ?? props.projectId, ...defaults },
  });
  const done = (message: string) => () => {
    toast.success(message);
    setOpen(false);
    if (!editing) form.reset();
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        editing ? (
          <Button variant="outline">
            <Pencil data-icon="inline-start" />
            {tc("edit")}
          </Button>
        ) : (
          <Button>
            <FilePlus2 data-icon="inline-start" />
            {t("contracts.create")}
          </Button>
        )
      }
      title={editing ? t("contracts.editTitle") : t("contracts.createTitle")}
      description={t("contracts.description")}
      submitLabel={editing ? tc("save") : t("contracts.create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(() => {
        const { targetId, ...fields } = form.getValues();
        const onError = (error: Parameters<typeof applyFieldErrors>[1]) =>
          applyFieldErrors(form, error);
        return editing
          ? update.run(
              { contractId: targetId, ...fields },
              { onSuccess: done(t("contracts.saved")), onError },
            )
          : create.run(
              { projectId: targetId, ...fields },
              { onSuccess: done(t("contracts.created")), onError },
            );
      })}
    >
      <SelectField
        control={form.control}
        name="supplierId"
        label={t("fields.contractor")}
        options={props.contractors.map((c) => ({ value: c.id, label: c.name }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="category"
          label={t("fields.category")}
          options={costCategories.map((c) => ({ value: c, label: t(`category.${c}`) }))}
        />
        <TextField
          control={form.control}
          name="reference"
          label={t("fields.reference")}
          dir="ltr"
        />
      </div>
      <TextField control={form.control} name="title" label={t("fields.title")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="amount"
          label={t("fields.contractAmount")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="retention"
          label={t("fields.retention")}
          inputMode="decimal"
          dir="ltr"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="signedOn"
          label={t("fields.signedOn")}
          type="date"
          dir="ltr"
          max={props.today}
        />
        <TextField
          control={form.control}
          name="plannedEndOn"
          label={t("fields.plannedEndOn")}
          type="date"
          dir="ltr"
        />
      </div>
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

type InvoiceValues = {
  number: string;
  invoicedOn: string;
  dueOn: string;
  label: string;
  gross: string;
};

/** A progress invoice (situation de travaux): new on a contract, or corrected while unpaid. */
export function WorksInvoiceDialog(
  props: { retentionBp: number; today: string } & (
    | { contractId: string; invoiceId?: undefined; values?: undefined }
    | { contractId?: undefined; invoiceId: string; values: InvoiceValues }
  ),
) {
  const t = useTranslations("costs");
  const tc = useTranslations("common");
  const money = useMoney();
  const editing = props.invoiceId !== undefined;
  const [open, setOpen] = useState(false);
  const create = useAction(recordWorksInvoiceAction);
  const update = useAction(updateWorksInvoiceAction);
  const form = useForm<
    z.input<typeof worksInvoiceFormSchema>,
    unknown,
    z.output<typeof worksInvoiceFormSchema>
  >({
    resolver: zodResolver(worksInvoiceFormSchema),
    defaultValues: {
      targetId: props.invoiceId ?? props.contractId,
      ...(props.values ?? { number: "", invoicedOn: props.today, dueOn: "", label: "", gross: "" }),
    },
  });
  const gross = parseDZD(useWatch({ control: form.control, name: "gross" }).trim());
  const split = gross !== null && gross > 0n ? invoiceSplit(gross, props.retentionBp) : null;
  const done = (message: string) => () => {
    toast.success(message);
    setOpen(false);
    if (!editing) form.reset();
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        editing ? (
          <Button variant="ghost" size="icon" className="size-8" aria-label={tc("edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <FilePlus2 data-icon="inline-start" />
            {t("invoices.create")}
          </Button>
        )
      }
      title={editing ? t("invoices.editTitle") : t("invoices.createTitle")}
      description={t("invoices.description")}
      submitLabel={editing ? tc("save") : t("invoices.create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(() => {
        const { targetId, ...fields } = form.getValues();
        const onError = (error: Parameters<typeof applyFieldErrors>[1]) =>
          applyFieldErrors(form, error);
        return editing
          ? update.run(
              { invoiceId: targetId, ...fields },
              { onSuccess: done(t("invoices.saved")), onError },
            )
          : create.run(
              { contractId: targetId, ...fields },
              { onSuccess: done(t("invoices.created")), onError },
            );
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="number"
          label={t("fields.invoiceNumber")}
          dir="ltr"
        />
        <TextField control={form.control} name="label" label={t("fields.period")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="invoicedOn"
          label={t("fields.invoicedOn")}
          type="date"
          dir="ltr"
          max={props.today}
        />
        <TextField
          control={form.control}
          name="dueOn"
          label={t("fields.dueOn")}
          type="date"
          dir="ltr"
        />
      </div>
      <TextField
        control={form.control}
        name="gross"
        label={t("fields.gross")}
        inputMode="decimal"
        dir="ltr"
      />
      {split ? (
        <p className="text-sm text-muted-foreground" data-testid="invoice-split">
          {t("invoices.split", { retention: money(split.retention), net: money(split.net) })}
        </p>
      ) : null}
    </FormDialog>
  );
}

/** Pays a progress invoice's net amount from an account. */
export function PayWorksInvoiceDialog({
  invoiceId,
  net,
  today,
  accounts,
}: {
  invoiceId: string;
  net: bigint;
  today: string;
  accounts: AccountOption[];
}) {
  const t = useTranslations("costs");
  const tp = useTranslations("payments");
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const pay = useAction(payWorksInvoiceAction);
  const form = useForm<
    z.input<typeof payWorksInvoiceSchema>,
    unknown,
    z.output<typeof payWorksInvoiceSchema>
  >({
    resolver: zodResolver(payWorksInvoiceSchema),
    defaultValues: {
      invoiceId,
      paidOn: today,
      method: "bank_transfer",
      reference: "",
      accountId: "",
    },
  });
  const method = useWatch({ control: form.control, name: "method" });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <Banknote data-icon="inline-start" />
          {t("invoices.pay")}
        </Button>
      }
      title={t("invoices.payTitle")}
      description={t("invoices.payDescription", { amount: money(net) })}
      submitLabel={t("invoices.pay")}
      pending={pay.pending}
      onSubmit={form.handleSubmit(() =>
        pay.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("invoices.paid"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="method"
          label={tp("fields.method")}
          options={costPaymentMethods.map((m) => ({ value: m, label: tp(`method.${m}`) }))}
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
      <TextField control={form.control} name="reference" label={tp("fields.reference")} dir="ltr" />
      <AccountField
        control={form.control}
        name="accountId"
        method={method}
        accounts={accounts}
        outgoing
      />
    </FormDialog>
  );
}

/** Réception provisoire or définitive of a contract. */
export function AcceptContractDialog({
  contractId,
  stage,
  today,
}: {
  contractId: string;
  stage: "provisional" | "final";
  today: string;
}) {
  const t = useTranslations("costs");
  const [open, setOpen] = useState(false);
  const accept = useAction(acceptContractAction);
  const form = useForm<
    z.input<typeof acceptContractSchema>,
    unknown,
    z.output<typeof acceptContractSchema>
  >({
    resolver: zodResolver(acceptContractSchema),
    defaultValues: { contractId, stage, acceptedOn: today, notes: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <CheckCheck data-icon="inline-start" />
          {t(`acceptance.${stage}`)}
        </Button>
      }
      title={t(`acceptance.${stage}Title`)}
      description={t(`acceptance.${stage}Description`)}
      submitLabel={t(`acceptance.${stage}`)}
      pending={accept.pending}
      onSubmit={form.handleSubmit(() =>
        accept.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("acceptance.recorded"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="acceptedOn"
        label={t("fields.acceptedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
      <TextareaField
        control={form.control}
        name="notes"
        label={t("fields.acceptanceNotes")}
        rows={3}
      />
    </FormDialog>
  );
}

/** Résiliation of a contract with its reason. */
export function TerminateContractDialog({
  contractId,
  today,
}: {
  contractId: string;
  today: string;
}) {
  const t = useTranslations("costs");
  const [open, setOpen] = useState(false);
  const terminate = useAction(terminateContractAction);
  const form = useForm<
    z.input<typeof terminateContractSchema>,
    unknown,
    z.output<typeof terminateContractSchema>
  >({
    resolver: zodResolver(terminateContractSchema),
    defaultValues: { contractId, terminatedOn: today, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <XCircle data-icon="inline-start" />
          {t("contracts.terminate")}
        </Button>
      }
      title={t("contracts.terminateTitle")}
      description={t("contracts.terminateDescription")}
      submitLabel={t("contracts.terminate")}
      destructive
      pending={terminate.pending}
      onSubmit={form.handleSubmit(() =>
        terminate.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("contracts.terminated"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="terminatedOn"
        label={t("fields.terminatedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
      <TextareaField control={form.control} name="reason" label={t("fields.reason")} rows={2} />
    </FormDialog>
  );
}

/** Pays the retention back after the réception définitive. */
export function ReleaseRetentionDialog({
  contractId,
  amount,
  today,
  accounts,
}: {
  contractId: string;
  amount: bigint;
  today: string;
  accounts: AccountOption[];
}) {
  const t = useTranslations("costs");
  const tp = useTranslations("payments");
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const release = useAction(releaseRetentionAction);
  const form = useForm<
    z.input<typeof releaseRetentionSchema>,
    unknown,
    z.output<typeof releaseRetentionSchema>
  >({
    resolver: zodResolver(releaseRetentionSchema),
    defaultValues: {
      contractId,
      paidOn: today,
      method: "bank_transfer",
      reference: "",
      accountId: "",
    },
  });
  const method = useWatch({ control: form.control, name: "method" });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <HandCoins data-icon="inline-start" />
          {t("retention.release")}
        </Button>
      }
      title={t("retention.releaseTitle")}
      description={t("retention.releaseDescription", { amount: money(amount) })}
      submitLabel={t("retention.release")}
      pending={release.pending}
      onSubmit={form.handleSubmit(() =>
        release.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("retention.released"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="method"
          label={tp("fields.method")}
          options={costPaymentMethods.map((m) => ({ value: m, label: tp(`method.${m}`) }))}
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
      <TextField control={form.control} name="reference" label={tp("fields.reference")} dir="ltr" />
      <AccountField
        control={form.control}
        name="accountId"
        method={method}
        accounts={accounts}
        outgoing
      />
    </FormDialog>
  );
}
