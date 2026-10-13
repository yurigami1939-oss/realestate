"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FilePlus2, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { consolePaymentMethods, vatRegimes } from "@/lib/billing";
import { formatDZD, parseDZD } from "@/lib/money";
import {
  cancelConsolePaymentAction,
  issueCreditNoteAction,
  issueInvoiceAction,
  recordConsolePaymentAction,
  saveOperatorProfileAction,
} from "@/server/console/actions";
import {
  cancelConsolePaymentSchema,
  consolePaymentSchema,
  creditNoteSchema,
  issueInvoiceSchema,
  MAX_INVOICE_LINES,
  operatorProfileSchema,
} from "@/server/console/schemas";

/** The operator's profile (CLAUDE.console.md §11), printed on the invoices issued afterwards. */
export function OperatorProfileForm({
  defaults,
}: {
  defaults: z.input<typeof operatorProfileSchema>;
}) {
  const t = useTranslations("console.settings");
  const save = useAction(saveOperatorProfileAction);
  const form = useForm<
    z.input<typeof operatorProfileSchema>,
    unknown,
    z.output<typeof operatorProfileSchema>
  >({ resolver: zodResolver(operatorProfileSchema), defaultValues: defaults });
  const regime = useWatch({ control: form.control, name: "vatRegime" });
  return (
    <form
      noValidate
      data-testid="operator-profile"
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => toast.success(t("saved")),
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <FieldGroup>
        <h2 className="text-headline">{t("identity")}</h2>
        <TextField control={form.control} name="legalName" label={t("legalName")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="brand" label={t("brand")} />
          <TextField control={form.control} name="legalForm" label={t("legalForm")} />
          <TextField control={form.control} name="address" label={t("address")} />
          <TextField control={form.control} name="wilaya" label={t("wilaya")} />
          <TextField control={form.control} name="phone" label={t("phone")} dir="ltr" />
          <TextField
            control={form.control}
            name="email"
            label={t("email")}
            type="email"
            dir="ltr"
          />
          <TextField control={form.control} name="rcNumber" label={t("rcNumber")} dir="ltr" />
          <TextField control={form.control} name="nif" label={t("nif")} dir="ltr" />
          <TextField control={form.control} name="nis" label={t("nis")} dir="ltr" />
          <TextField control={form.control} name="aiNumber" label={t("aiNumber")} dir="ltr" />
        </div>
        <h2 className="pt-2 text-headline">{t("invoicing")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="bank" label={t("bank")} />
          <TextField control={form.control} name="rib" label={t("rib")} dir="ltr" />
          <SelectField
            control={form.control}
            name="vatRegime"
            label={t("vatRegime")}
            options={vatRegimes.map((r) => ({ value: r, label: t(`vatRegimes.${r}`) }))}
          />
          {regime === "vat" ? (
            <TextField
              control={form.control}
              name="vatRate"
              label={t("vatRate")}
              inputMode="decimal"
              dir="ltr"
            />
          ) : null}
          <TextField
            control={form.control}
            name="paymentTermsDays"
            label={t("paymentTermsDays")}
            inputMode="numeric"
            dir="ltr"
          />
        </div>
        <TextareaField control={form.control} name="footerFr" label={t("footerFr")} rows={2} />
        <TextareaField
          control={form.control}
          name="footerAr"
          label={t("footerAr")}
          rows={2}
          dir="rtl"
        />
        <div>
          <Button type="submit" disabled={save.pending}>
            {t("save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

/** The operator's logo: uploaded (PNG or JPEG, 2 MB) or removed. */
export function OperatorLogoForm({ hasLogo }: { hasLogo: boolean }) {
  const t = useTranslations("console.settings");
  const translate = useTranslateKey();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const send = async (file: File | null) => {
    setPending(true);
    const body = new FormData();
    body.set("file", file ?? new File([], "none"));
    try {
      const response = await fetch("/api/console/logo", { method: "POST", body });
      const result = (await response.json()) as
        { ok: true } | { ok: false; error: { messageKey: string } };
      if (result.ok) {
        toast.success(t("logoSaved"));
        router.refresh();
      } else {
        toast.error(translate(result.error.messageKey));
      }
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        aria-label={t("logoUpload")}
        onChange={(event) => void send(event.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        {t("logoUpload")}
      </Button>
      {hasLogo ? (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => void send(null)}>
          {t("logoRemove")}
        </Button>
      ) : null}
    </div>
  );
}

/** A prefilled line, as form text. */
export type DraftLineInput = z.input<typeof issueInvoiceSchema>["lines"][number];

/**
 * Issues an invoice (CLAUDE.console.md §11): the lines prefilled for the next period, edited,
 * removed or added before issuing; the HT total follows as typed.
 */
export function IssueInvoiceDialog({
  billingAccountId,
  lines,
  today,
}: {
  billingAccountId: string;
  lines: DraftLineInput[];
  today: string;
}) {
  const t = useTranslations("console.billing");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const translate = useTranslateKey();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const issue = useAction(issueInvoiceAction);
  const defaults = { billingAccountId, issuedOn: today, lines };
  const form = useForm<
    z.input<typeof issueInvoiceSchema>,
    unknown,
    z.output<typeof issueInvoiceSchema>
  >({ resolver: zodResolver(issueInvoiceSchema), defaultValues: defaults });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const typed = useWatch({ control: form.control, name: "lines" });
  // The list's own errors (none, more than 30), not any one line's.
  const linesError =
    form.formState.errors.lines?.message ?? form.formState.errors.lines?.root?.message;
  const total = (typed ?? []).reduce((sum, line) => {
    const price = parseDZD(line.unitPrice ?? "") ?? 0n;
    const quantity = Number.parseInt(line.quantity ?? "", 10);
    return Number.isFinite(quantity) && quantity > 0 ? sum + price * BigInt(quantity) : sum;
  }, 0n);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
      }}
      className="sm:max-w-3xl"
      trigger={
        <Button data-testid="invoice-issue">
          <FilePlus2 data-icon="inline-start" />
          {t("issue")}
        </Button>
      }
      title={t("issueTitle")}
      description={t("issueDescription")}
      submitLabel={t("issue")}
      pending={issue.pending}
      onSubmit={form.handleSubmit(() =>
        issue.run(form.getValues(), {
          onSuccess: ({ number }) => {
            toast.success(t("issued", { number }));
            setOpen(false);
          },
          onError: (error) => {
            applyFieldErrors(form, error);
            // A stale draft (another tab issued it): the page drafts the next period again.
            if (error.messageKey === "console.errors.periodInvoiced") {
              setOpen(false);
              router.refresh();
            }
          },
        }),
      )}
    >
      <TextField
        control={form.control}
        name="issuedOn"
        label={t("issuedOn")}
        type="date"
        dir="ltr"
        className="sm:max-w-48"
      />
      <ol className="space-y-3">
        {fields.map((field, index) => (
          <li key={field.id} className="space-y-2 rounded-lg bg-muted/50 p-3" data-line={index}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-footnote font-medium text-muted-foreground">
                {t(`kinds.${typed?.[index]?.kind ?? field.kind}`)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("removeLine")}
                disabled={fields.length === 1}
                onClick={() => remove(index)}
              >
                <Trash2 />
              </Button>
            </div>
            <TextField
              control={form.control}
              name={`lines.${index}.labelFr`}
              label={t("labelFr")}
            />
            <TextField
              control={form.control}
              name={`lines.${index}.labelAr`}
              label={t("labelAr")}
              dir="rtl"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                control={form.control}
                name={`lines.${index}.quantity`}
                label={t("quantity")}
                inputMode="numeric"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name={`lines.${index}.unitPrice`}
                label={t("unitPrice")}
                inputMode="decimal"
                dir="ltr"
              />
            </div>
          </li>
        ))}
      </ol>
      {linesError ? (
        <p role="alert" className="text-sm text-danger">
          {translate(linesError)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={fields.length >= MAX_INVOICE_LINES}
          onClick={() =>
            append({
              kind: "other",
              addonCode: "",
              labelFr: "",
              labelAr: "",
              periodStart: "",
              periodEnd: "",
              quantity: "1",
              unitPrice: "",
            })
          }
        >
          <Plus data-icon="inline-start" />
          {t("addLine")}
        </Button>
        <span className="text-sm font-medium tabular-nums" data-testid="invoice-total">
          {t("totalHt", { amount: formatDZD(total, locale) })}
        </span>
      </div>
    </FormDialog>
  );
}

/** Records a client's payment of an invoice (never cash), up to what remains. */
export function PaymentDialog({
  invoice,
  today,
}: {
  invoice: { id: string; number: string; remaining: string; remainingInput: string };
  today: string;
}) {
  const t = useTranslations("console.billing");
  const [open, setOpen] = useState(false);
  const pay = useAction(recordConsolePaymentAction);
  const defaults = {
    invoiceId: invoice.id,
    paidOn: today,
    amount: invoice.remainingInput,
    method: "bank_transfer" as const,
    reference: "",
  };
  const form = useForm<
    z.input<typeof consolePaymentSchema>,
    unknown,
    z.output<typeof consolePaymentSchema>
  >({ resolver: zodResolver(consolePaymentSchema), defaultValues: defaults });
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
      }}
      trigger={
        <Button variant="outline" size="sm" data-testid="invoice-pay">
          {t("pay")}
        </Button>
      }
      title={t("payTitle")}
      description={t("payDescription", { number: invoice.number, amount: invoice.remaining })}
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
        <TextField control={form.control} name="paidOn" label={t("paidOn")} type="date" dir="ltr" />
        <TextField
          control={form.control}
          name="amount"
          label={t("amount")}
          inputMode="decimal"
          dir="ltr"
        />
        <SelectField
          control={form.control}
          name="method"
          label={t("method")}
          options={consolePaymentMethods.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
        />
        <TextField control={form.control} name="reference" label={t("reference")} dir="ltr" />
      </div>
    </FormDialog>
  );
}

/** A credit note on an invoice, up to what remains, with a reason. */
export function CreditNoteDialog({
  invoice,
  today,
}: {
  invoice: { id: string; number: string; remaining: string; remainingInput: string };
  today: string;
}) {
  const t = useTranslations("console.billing");
  const [open, setOpen] = useState(false);
  const credit = useAction(issueCreditNoteAction);
  const defaults = { invoiceId: invoice.id, issuedOn: today, amount: "", reason: "" };
  const form = useForm<
    z.input<typeof creditNoteSchema>,
    unknown,
    z.output<typeof creditNoteSchema>
  >({ resolver: zodResolver(creditNoteSchema), defaultValues: defaults });
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
      }}
      trigger={
        <Button variant="ghost" size="sm" data-testid="invoice-credit">
          {t("credit")}
        </Button>
      }
      title={t("creditTitle")}
      description={t("creditDescription", { number: invoice.number, amount: invoice.remaining })}
      submitLabel={t("credit")}
      pending={credit.pending}
      onSubmit={form.handleSubmit(() =>
        credit.run(form.getValues(), {
          onSuccess: ({ number }) => {
            toast.success(t("credited", { number }));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="issuedOn"
          label={t("issuedOn")}
          type="date"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="amount"
          label={t("creditAmount")}
          inputMode="decimal"
          dir="ltr"
          placeholder={invoice.remainingInput}
        />
      </div>
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}

/** Cancels a payment (a bounced cheque) with a reason; it stays listed. */
export function CancelPaymentDialog({ paymentId }: { paymentId: string }) {
  const t = useTranslations("console.billing");
  const [open, setOpen] = useState(false);
  const cancel = useAction(cancelConsolePaymentAction);
  const form = useForm<
    z.input<typeof cancelConsolePaymentSchema>,
    unknown,
    z.output<typeof cancelConsolePaymentSchema>
  >({
    resolver: zodResolver(cancelConsolePaymentSchema),
    defaultValues: { paymentId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      destructive
      trigger={
        <Button variant="ghost" size="sm">
          {t("cancelPayment")}
        </Button>
      }
      title={t("cancelTitle")}
      description={t("cancelDescription")}
      submitLabel={t("cancelPayment")}
      pending={cancel.pending}
      onSubmit={form.handleSubmit(() =>
        cancel.run(form.getValues(), {
          onSuccess: () => setOpen(false),
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}
