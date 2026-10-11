"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Ban,
  Banknote,
  FileSignature,
  FileText,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  type FieldValues,
  type UseFormReturn,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { PendingPdf } from "@/components/rentals/rentals-ui";
import { AccountField, type AccountOption } from "@/components/treasury/account-field";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { formatDZD, parseDZD } from "@/lib/money";
import { rentPaymentMethods } from "@/lib/rentals";
import type { AppErrorShape } from "@/lib/result";
import {
  cancelOwnerStatementAction,
  createMandateAction,
  createOwnerAction,
  endMandateAction,
  issueOwnerStatementAction,
  payOwnerStatementAction,
  requestOwnerStatementPdfAction,
  updateOwnerAction,
} from "@/server/mandates/actions";
import {
  cancelOwnerStatementSchema,
  createMandateSchema,
  endMandateSchema,
  issueOwnerStatementSchema,
  ownerFields,
  payOwnerStatementSchema,
} from "@/server/mandates/schemas";

const fieldErrors =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any context/output types
  <T extends FieldValues>(form: UseFormReturn<T, any, any>) =>
    (error: AppErrorShape) =>
      applyFieldErrors(form, error);

type OwnerValues = z.input<typeof ownerFields>;

const emptyOwner: OwnerValues = {
  name: "",
  nameAr: "",
  idNumber: "",
  phone: "",
  email: "",
  address: "",
  bank: "",
  rib: "",
  notes: "",
};

/** A new owner (then its page), or corrects one (`ownerId`). */
export function OwnerDialog({
  ownerId,
  current = emptyOwner,
}: {
  ownerId?: string;
  current?: OwnerValues;
}) {
  const t = useTranslations("mandates.owner");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = useAction(createOwnerAction);
  const update = useAction(updateOwnerAction);
  const form = useForm<OwnerValues, unknown, z.output<typeof ownerFields>>({
    resolver: zodResolver(ownerFields),
    defaultValues: current,
  });
  const f = (key: keyof OwnerValues) => t(`fields.${key}`);
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        ownerId ? (
          <Button variant="outline" size="sm">
            <Pencil data-icon="inline-start" />
            {t("edit")}
          </Button>
        ) : (
          <Button>
            <UserPlus data-icon="inline-start" />
            {t("new")}
          </Button>
        )
      }
      title={ownerId ? t("editTitle") : t("newTitle")}
      description={t("description")}
      submitLabel={ownerId ? t("save") : t("create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(() => {
        const values = form.getValues();
        if (ownerId) {
          void update.run(
            { ...values, ownerId },
            {
              onSuccess: () => {
                toast.success(t("saved"));
                setOpen(false);
              },
              onError: fieldErrors(form),
            },
          );
        } else {
          void create.run(values, {
            onSuccess: ({ id }) => {
              toast.success(t("created"));
              setOpen(false);
              router.push(`/rentals/owners/${id}`);
            },
            onError: fieldErrors(form),
          });
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="name" label={f("name")} />
        <TextField control={form.control} name="nameAr" label={f("nameAr")} dir="rtl" />
        <TextField control={form.control} name="phone" label={f("phone")} dir="ltr" />
        <TextField control={form.control} name="email" label={f("email")} dir="ltr" />
        <TextField control={form.control} name="idNumber" label={f("idNumber")} dir="ltr" />
        <TextField control={form.control} name="address" label={f("address")} />
        <TextField control={form.control} name="bank" label={f("bank")} />
        <TextField control={form.control} name="rib" label={f("rib")} dir="ltr" />
      </div>
      <TextareaField control={form.control} name="notes" label={f("notes")} rows={2} />
    </FormDialog>
  );
}

type MandateValues = z.input<typeof createMandateSchema>;

/** Entrusts one of the owner's units to the organization (delivered, under no mandate). */
export function MandateDialog({
  ownerId,
  units,
  today,
}: {
  ownerId: string;
  units: { id: string; code: string; projectName: string }[];
  today: string;
}) {
  const t = useTranslations("mandates.mandate");
  const [open, setOpen] = useState(false);
  const create = useAction(createMandateAction);
  const form = useForm<MandateValues, unknown, z.output<typeof createMandateSchema>>({
    resolver: zodResolver(createMandateSchema),
    defaultValues: {
      ownerId,
      unitId: "",
      signedOn: today,
      startOn: today,
      feeRate: "",
      notes: "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <FileSignature data-icon="inline-start" />
          {t("new")}
        </Button>
      }
      title={t("newTitle")}
      description={t("description")}
      submitLabel={t("create")}
      pending={create.pending}
      onSubmit={form.handleSubmit(() =>
        create.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("created"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="unitId"
        label={t("unit")}
        options={units.map((u) => ({ value: u.id, label: `${u.code} · ${u.projectName}` }))}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          control={form.control}
          name="signedOn"
          label={t("signedOn")}
          type="date"
          max={today}
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="startOn"
          label={t("startOn")}
          type="date"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="feeRate"
          label={t("feeRate")}
          inputMode="decimal"
          dir="ltr"
        />
      </div>
      <TextareaField control={form.control} name="notes" label={t("notes")} rows={2} />
    </FormDialog>
  );
}

/** Ends a mandate once its unit has no active lease. */
export function EndMandateDialog({ mandateId, today }: { mandateId: string; today: string }) {
  const t = useTranslations("mandates.mandate");
  const [open, setOpen] = useState(false);
  const end = useAction(endMandateAction);
  const form = useForm<
    z.input<typeof endMandateSchema>,
    unknown,
    z.output<typeof endMandateSchema>
  >({
    resolver: zodResolver(endMandateSchema),
    defaultValues: { mandateId, endedOn: today, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <Ban data-icon="inline-start" />
          {t("end")}
        </Button>
      }
      title={t("endTitle")}
      description={t("endDescription")}
      submitLabel={t("end")}
      destructive
      pending={end.pending}
      onSubmit={form.handleSubmit(() =>
        end.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("ended"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="endedOn"
        label={t("endedOn")}
        type="date"
        max={today}
        dir="ltr"
      />
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}

type StatementValues = z.input<typeof issueOwnerStatementSchema>;

/**
 * Issues the owner's statement up to a day: the rents not reported yet (shown as of today), less
 * the fees and the deductions typed here.
 */
export function IssueStatementDialog({
  ownerId,
  today,
  pending,
}: {
  ownerId: string;
  today: string;
  /** What a statement up to today would report: rents and fees. */
  pending: { lines: number; collected: bigint; fees: bigint };
}) {
  const t = useTranslations("mandates.statement");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const issue = useAction(issueOwnerStatementAction);
  const form = useForm<StatementValues, unknown, z.output<typeof issueOwnerStatementSchema>>({
    resolver: zodResolver(issueOwnerStatementSchema),
    defaultValues: { ownerId, periodTo: today, extras: [] },
  });
  const extras = useFieldArray({ control: form.control, name: "extras" });
  const typed = useWatch({ control: form.control, name: "extras" }) ?? [];
  const deductions = typed.reduce((sum, e) => sum + (parseDZD(e?.amount ?? "") ?? 0n), 0n);
  const money = (v: bigint) => formatDZD(v, locale);
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" disabled={pending.lines === 0}>
          <FileText data-icon="inline-start" />
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
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="periodTo"
        label={t("periodTo")}
        type="date"
        max={today}
        dir="ltr"
      />
      <dl className="grid gap-1 rounded-md border p-3 text-sm" data-testid="statement-preview">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("preview.lines", { count: pending.lines })}</dt>
          <dd dir="ltr">{money(pending.collected)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("preview.fees")}</dt>
          <dd dir="ltr">− {money(pending.fees)}</dd>
        </div>
        {deductions > 0n ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("preview.deductions")}</dt>
            <dd dir="ltr">− {money(deductions)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 font-medium">
          <dt>{t("preview.net")}</dt>
          <dd dir="ltr">{money(pending.collected - pending.fees - deductions)}</dd>
        </div>
      </dl>
      <div className="space-y-2">
        {extras.fields.map((field, index) => (
          <div key={field.id} className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <TextField
              control={form.control}
              name={`extras.${index}.label`}
              label={t("extraLabel")}
            />
            <TextField
              control={form.control}
              name={`extras.${index}.amount`}
              label={t("extraAmount")}
              inputMode="decimal"
              dir="ltr"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("removeExtra")}
              onClick={() => extras.remove(index)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => extras.append({ label: "", amount: "" })}
        >
          <Plus data-icon="inline-start" />
          {t("addExtra")}
        </Button>
      </div>
    </FormDialog>
  );
}

type PayValues = z.input<typeof payOwnerStatementSchema>;

/** Pays a statement's net out to its owner from a cash desk or an account. */
export function PayStatementDialog({
  statementId,
  today,
  accounts,
}: {
  statementId: string;
  today: string;
  accounts: AccountOption[];
}) {
  const t = useTranslations("mandates.statement");
  const tp = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const pay = useAction(payOwnerStatementAction);
  const form = useForm<PayValues, unknown, z.output<typeof payOwnerStatementSchema>>({
    resolver: zodResolver(payOwnerStatementSchema),
    defaultValues: {
      statementId,
      paidOn: today,
      method: "bank_transfer",
      reference: "",
      accountId: "",
    },
  });
  const method = useWatch({ control: form.control, name: "method" }) ?? "bank_transfer";
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <Banknote data-icon="inline-start" />
          {t("pay")}
        </Button>
      }
      title={t("payTitle")}
      description={t("payDescription")}
      submitLabel={t("pay")}
      pending={pay.pending}
      onSubmit={form.handleSubmit(() =>
        pay.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("paid"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="paidOn"
          label={t("paidOn")}
          type="date"
          max={today}
          dir="ltr"
        />
        <SelectField
          control={form.control}
          name="method"
          label={tp("fields.method")}
          options={rentPaymentMethods.map((m) => ({ value: m, label: tp(`method.${m}`) }))}
        />
        <TextField control={form.control} name="reference" label={t("reference")} dir="ltr" />
        <AccountField
          control={form.control}
          name="accountId"
          method={method}
          accounts={accounts}
          outgoing
        />
      </div>
    </FormDialog>
  );
}

/** Cancels an unpaid statement with a reason: its rents go on the next one. */
export function CancelStatementDialog({ statementId }: { statementId: string }) {
  const t = useTranslations("mandates.statement");
  const [open, setOpen] = useState(false);
  const cancel = useAction(cancelOwnerStatementAction);
  const form = useForm<
    z.input<typeof cancelOwnerStatementSchema>,
    unknown,
    z.output<typeof cancelOwnerStatementSchema>
  >({
    resolver: zodResolver(cancelOwnerStatementSchema),
    defaultValues: { statementId, reason: "" },
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
      title={t("cancelTitle")}
      description={t("cancelDescription")}
      submitLabel={t("cancel")}
      destructive
      pending={cancel.pending}
      onSubmit={form.handleSubmit(() =>
        cancel.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("cancelled"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}

/** Link to a statement's PDF; while the worker renders it, a pending note and a retry button. */
export function OwnerStatementPdf({
  fileId,
  statementId,
  label,
}: {
  fileId: string | null;
  statementId: string;
  label: string;
}) {
  const retry = useAction(requestOwnerStatementPdfAction);
  return (
    <PendingPdf
      fileId={fileId}
      label={label}
      pending={retry.pending}
      onRetry={(done) => void retry.run({ statementId }, { onSuccess: done })}
    />
  );
}
