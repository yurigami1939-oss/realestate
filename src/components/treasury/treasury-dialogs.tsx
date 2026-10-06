"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftRight, Ban, Calculator, Lock, Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { formatDZD, parseDZD } from "@/lib/money";
import {
  manualMovementKinds,
  type TreasuryAccountKind,
  treasuryAccountKinds,
} from "@/lib/treasury";
import {
  cancelMovementAction,
  closeAccountAction,
  createAccountAction,
  recordCashCountAction,
  recordMovementAction,
  updateAccountAction,
} from "@/server/treasury/actions";
import {
  cancelMovementSchema,
  cashCountSchema,
  closeAccountSchema,
  createAccountSchema,
  recordMovementSchema,
  updateAccountSchema,
} from "@/server/treasury/schemas";

type AccountChoice = { id: string; name: string; kind: TreasuryAccountKind };

/** Opens a cash desk or an account with its balance on its opening day. */
export function CreateAccountDialog({ today }: { today: string }) {
  const t = useTranslations("treasury");
  const [open, setOpen] = useState(false);
  const create = useAction(createAccountAction);
  const form = useForm<
    z.input<typeof createAccountSchema>,
    unknown,
    z.output<typeof createAccountSchema>
  >({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      kind: "cash",
      name: "",
      bankName: "",
      accountNumber: "",
      isDefault: true,
      notes: "",
      openingBalance: "0",
      openingOn: today,
    },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Plus data-icon="inline-start" />
          {t("accounts.create")}
        </Button>
      }
      title={t("accounts.createTitle")}
      description={t("accounts.createDescription")}
      submitLabel={t("accounts.create")}
      pending={create.pending}
      onSubmit={form.handleSubmit(() =>
        create.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("accounts.created"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="kind"
        label={t("fields.kind")}
        options={treasuryAccountKinds.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
      />
      <TextField control={form.control} name="name" label={t("fields.name")} />
      {kind === "cash" ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="bankName" label={t("fields.bankName")} />
          <TextField
            control={form.control}
            name="accountNumber"
            label={t("fields.accountNumber")}
            dir="ltr"
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="openingBalance"
          label={t("fields.openingBalance")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="openingOn"
          label={t("fields.openingOn")}
          type="date"
          dir="ltr"
          max={today}
        />
      </div>
      <CheckboxField control={form.control} name="isDefault" label={t("fields.isDefault")} />
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

/** Renames an account, its bank details, its default flag or notes. */
export function EditAccountDialog({
  account,
}: {
  account: {
    id: string;
    kind: TreasuryAccountKind;
    name: string;
    bankName: string | null;
    accountNumber: string | null;
    isDefault: boolean;
    notes: string | null;
  };
}) {
  const t = useTranslations("treasury");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const update = useAction(updateAccountAction);
  const form = useForm<
    z.input<typeof updateAccountSchema>,
    unknown,
    z.output<typeof updateAccountSchema>
  >({
    resolver: zodResolver(updateAccountSchema),
    defaultValues: {
      accountId: account.id,
      name: account.name,
      bankName: account.bankName ?? "",
      accountNumber: account.accountNumber ?? "",
      isDefault: account.isDefault,
      notes: account.notes ?? "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Pencil data-icon="inline-start" />
          {tc("edit")}
        </Button>
      }
      title={t("accounts.editTitle")}
      submitLabel={tc("save")}
      pending={update.pending}
      onSubmit={form.handleSubmit(() =>
        update.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("accounts.saved"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="name" label={t("fields.name")} />
      {account.kind === "cash" ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="bankName" label={t("fields.bankName")} />
          <TextField
            control={form.control}
            name="accountNumber"
            label={t("fields.accountNumber")}
            dir="ltr"
          />
        </div>
      )}
      <CheckboxField control={form.control} name="isDefault" label={t("fields.isDefault")} />
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

/** Closes an empty account (transfer what remains first). */
export function CloseAccountDialog({ accountId, today }: { accountId: string; today: string }) {
  const t = useTranslations("treasury");
  const [open, setOpen] = useState(false);
  const close = useAction(closeAccountAction);
  const form = useForm<
    z.input<typeof closeAccountSchema>,
    unknown,
    z.output<typeof closeAccountSchema>
  >({
    resolver: zodResolver(closeAccountSchema),
    defaultValues: { accountId, closedOn: today },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Lock data-icon="inline-start" />
          {t("accounts.close")}
        </Button>
      }
      title={t("accounts.closeTitle")}
      description={t("accounts.closeDescription")}
      submitLabel={t("accounts.close")}
      destructive
      pending={close.pending}
      onSubmit={form.handleSubmit(() =>
        close.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("accounts.closed"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="closedOn"
        label={t("fields.closedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
    </FormDialog>
  );
}

/**
 * A manual movement: income, expense or bank fee on an account, or a transfer to another one
 * (e.g. the cash desk's takings paid into the bank).
 */
export function MovementDialog({
  accounts,
  accountId,
  today,
}: {
  accounts: AccountChoice[];
  accountId?: string;
  today: string;
}) {
  const t = useTranslations("treasury");
  const [open, setOpen] = useState(false);
  const record = useAction(recordMovementAction);
  const form = useForm<
    z.input<typeof recordMovementSchema>,
    unknown,
    z.output<typeof recordMovementSchema>
  >({
    resolver: zodResolver(recordMovementSchema),
    defaultValues: {
      kind: "expense",
      accountId: accountId ?? accounts[0]?.id ?? "",
      toAccountId: "",
      amount: "",
      movedOn: today,
      label: "",
      category: "",
      reference: "",
    },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const from = useWatch({ control: form.control, name: "accountId" });
  const options = accounts.map((a) => ({ value: a.id, label: a.name }));
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant={accountId ? "outline" : "default"}>
          <ArrowLeftRight data-icon="inline-start" />
          {t("movements.record")}
        </Button>
      }
      title={t("movements.recordTitle")}
      description={t("movements.recordDescription")}
      submitLabel={t("movements.record")}
      pending={record.pending}
      onSubmit={form.handleSubmit(() =>
        record.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("movements.recorded"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="kind"
        label={t("fields.movementKind")}
        options={manualMovementKinds.map((k) => ({ value: k, label: t(`movementKind.${k}`) }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="accountId"
          label={kind === "transfer" ? t("fields.fromAccount") : t("fields.account")}
          options={options}
        />
        {kind === "transfer" ? (
          <SelectField
            control={form.control}
            name="toAccountId"
            label={t("fields.toAccount")}
            options={options.filter((o) => o.value !== from)}
          />
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="amount"
          label={t("fields.amount")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="movedOn"
          label={t("fields.movedOn")}
          type="date"
          dir="ltr"
          max={today}
        />
      </div>
      <TextField control={form.control} name="label" label={t("fields.label")} />
      <div className="grid gap-4 sm:grid-cols-2">
        {kind === "transfer" ? null : (
          <TextField control={form.control} name="category" label={t("fields.category")} />
        )}
        <TextField
          control={form.control}
          name="reference"
          label={t("fields.reference")}
          dir="ltr"
        />
      </div>
    </FormDialog>
  );
}

/** Cancels a manual movement (both sides of a transfer) with a reason. */
export function CancelMovementDialog({ movementId }: { movementId: string }) {
  const t = useTranslations("treasury");
  const [open, setOpen] = useState(false);
  const cancel = useAction(cancelMovementAction);
  const form = useForm<
    z.input<typeof cancelMovementSchema>,
    unknown,
    z.output<typeof cancelMovementSchema>
  >({
    resolver: zodResolver(cancelMovementSchema),
    defaultValues: { movementId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="icon" className="size-8" aria-label={t("movements.cancel")}>
          <Ban />
        </Button>
      }
      title={t("movements.cancelTitle")}
      description={t("movements.cancelDescription")}
      submitLabel={t("movements.cancel")}
      destructive
      pending={cancel.pending}
      onSubmit={form.handleSubmit(() =>
        cancel.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("movements.cancelled"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("fields.reason")} rows={2} />
    </FormDialog>
  );
}

/** Arrêté de caisse: the cash counted against the ledger's balance of the day. */
export function CashCountDialog({
  accountId,
  balance,
  today,
}: {
  accountId: string;
  /** Today's balance, shown as the expected amount. */
  balance: bigint;
  today: string;
}) {
  const t = useTranslations("treasury");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const record = useAction(recordCashCountAction);
  const form = useForm<z.input<typeof cashCountSchema>, unknown, z.output<typeof cashCountSchema>>({
    resolver: zodResolver(cashCountSchema),
    defaultValues: { accountId, countedOn: today, counted: "", note: "" },
  });
  const counted = useWatch({ control: form.control, name: "counted" });
  const countedOn = useWatch({ control: form.control, name: "countedOn" });
  const amount = parseDZD(counted.trim());
  const difference = amount === null || countedOn !== today ? null : amount - balance;
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Calculator data-icon="inline-start" />
          {t("counts.record")}
        </Button>
      }
      title={t("counts.recordTitle")}
      description={t("counts.recordDescription")}
      submitLabel={t("counts.record")}
      pending={record.pending}
      onSubmit={form.handleSubmit(() =>
        record.run(form.getValues(), {
          onSuccess: ({ difference: gap }) => {
            toast.success(
              gap === 0n
                ? t("counts.balanced")
                : t("counts.recorded", { difference: formatDZD(gap, locale) }),
            );
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="countedOn"
        label={t("fields.countedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
      <p className="text-sm text-muted-foreground">
        {t("counts.expected", { amount: formatDZD(balance, locale) })}
      </p>
      <TextField
        control={form.control}
        name="counted"
        label={t("fields.counted")}
        inputMode="decimal"
        dir="ltr"
      />
      {difference !== null && difference !== 0n ? (
        <p className="text-sm text-amber-800" data-testid="cash-count-difference">
          {t("counts.difference", { amount: formatDZD(difference, locale) })}
        </p>
      ) : null}
      <TextareaField control={form.control} name="note" label={t("fields.note")} rows={2} />
    </FormDialog>
  );
}
