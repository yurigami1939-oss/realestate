"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { AccountField, type AccountOption } from "@/components/treasury/account-field";
import { Button } from "@/components/ui/button";
import { formatAmountInput } from "@/lib/money";
import { chargePaymentMethods } from "@/lib/residences";
import type { AppErrorShape } from "@/lib/result";
import {
  payInvoiceAction,
  recordInvoiceAction,
  updateInvoiceAction,
} from "@/server/suppliers/actions";
import type { ContractRow, InvoiceRow } from "@/server/suppliers/queries";
import { createInvoiceSchema, payInvoiceSchema } from "@/server/suppliers/schemas";

type InvoiceValues = z.input<typeof createInvoiceSchema>;

/**
 * Record (no `invoice`) or edit a supplier invoice of a residence: booked to a category (the
 * contract's by default) or paid from the reserve fund.
 */
export function InvoiceDialog({
  residenceId,
  invoice,
  suppliers,
  categories,
  contracts,
  today,
}: {
  residenceId: string;
  invoice?: InvoiceRow;
  suppliers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  contracts: ContractRow[];
  today: string;
}) {
  const t = useTranslations("suppliers.invoices");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const record = useAction(recordInvoiceAction);
  const update = useAction(updateInvoiceAction);
  const form = useForm<InvoiceValues, unknown, z.output<typeof createInvoiceSchema>>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: {
      supplierId: invoice?.supplierId ?? suppliers[0]?.id ?? "",
      residenceId,
      categoryId: invoice?.categoryId ?? "",
      contractId: invoice?.contractId ?? "",
      number: invoice?.number ?? "",
      invoiceOn: invoice?.invoiceOn ?? today,
      dueOn: invoice?.dueOn ?? "",
      label: invoice?.label ?? "",
      amount: invoice ? formatAmountInput(invoice.amount) : "",
      fromReserve: invoice?.fromReserve ?? false,
      notes: invoice?.notes ?? "",
    },
  });
  const supplierId = useWatch({ control: form.control, name: "supplierId" });
  const contractId = useWatch({ control: form.control, name: "contractId" });
  const fromReserve = useWatch({ control: form.control, name: "fromReserve" });
  const supplierContracts = contracts.filter((c) => c.supplierId === supplierId);
  // A contract books its invoices to its category by default.
  useEffect(() => {
    const category = contracts.find((c) => c.id === contractId)?.categoryId;
    if (category) form.setValue("categoryId", category);
  }, [contractId, contracts, form]);

  function submit() {
    const values = form.getValues();
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (invoice) {
      const { supplierId: _s, residenceId: _r, ...fields } = values;
      return update.run(
        { ...fields, invoiceId: invoice.id },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            setOpen(false);
          },
          onError,
        },
      );
    }
    return record.run(values, {
      onSuccess: () => {
        toast.success(t("recorded"));
        form.reset();
        setOpen(false);
      },
      onError,
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        invoice ? (
          <Button variant="ghost" size="sm">
            <Pencil data-icon="inline-start" />
            {tc("edit")}
          </Button>
        ) : (
          <Button variant="outline">
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        )
      }
      title={invoice ? t("editTitle", { number: invoice.number }) : t("newTitle")}
      submitLabel={invoice ? tc("save") : t("record")}
      pending={record.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      {invoice ? null : (
        <SelectField
          control={form.control}
          name="supplierId"
          label={t("fields.supplierId")}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
      )}
      <SelectField
        key={supplierId}
        control={form.control}
        name="contractId"
        label={t("fields.contractId")}
        emptyLabel={t("noContract")}
        options={supplierContracts.map((c) => ({ value: c.id, label: c.label }))}
      />
      <CheckboxField control={form.control} name="fromReserve" label={t("fields.fromReserve")} />
      {fromReserve ? null : (
        <SelectField
          control={form.control}
          name="categoryId"
          label={t("fields.categoryId")}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="number" label={t("fields.number")} dir="ltr" />
        <TextField
          control={form.control}
          name="amount"
          label={t("fields.amount")}
          inputMode="decimal"
          dir="ltr"
        />
      </div>
      <TextField control={form.control} name="label" label={t("fields.label")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="invoiceOn"
          label={t("fields.invoiceOn")}
          type="date"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="dueOn"
          label={t("fields.dueOn")}
          type="date"
          dir="ltr"
        />
      </div>
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

type PayValues = z.input<typeof payInvoiceSchema>;

/** Records the payment of a supplier invoice (date, method, reference). */
export function PayInvoiceDialog({
  invoiceId,
  number,
  today,
  accounts,
}: {
  invoiceId: string;
  number: string;
  today: string;
  /** Cash desks and accounts it may be paid from. */
  accounts: AccountOption[];
}) {
  const t = useTranslations("suppliers.invoices");
  const tp = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const pay = useAction(payInvoiceAction);
  const form = useForm<PayValues, unknown, z.output<typeof payInvoiceSchema>>({
    resolver: zodResolver(payInvoiceSchema),
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
        <Button variant="ghost" size="sm">
          <Banknote data-icon="inline-start" />
          {t("pay")}
        </Button>
      }
      title={t("payTitle", { number })}
      submitLabel={t("pay")}
      pending={pay.pending}
      onSubmit={form.handleSubmit(() =>
        pay.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("paid"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="paidOn"
          label={t("fields.paidOn")}
          type="date"
          dir="ltr"
          max={today}
        />
        <SelectField
          control={form.control}
          name="method"
          label={tp("fields.method")}
          options={chargePaymentMethods.map((m) => ({ value: m, label: tp(`method.${m}`) }))}
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
