"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarRange, FolderClosed, FolderOpen, ListPlus, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { recoveryStepKinds } from "@/lib/recovery";
import {
  addRecoveryStepAction,
  cancelRepaymentPlanAction,
  closeRecoveryAction,
  createRepaymentPlanAction,
  openRecoveryAction,
} from "@/server/charges/actions";
import {
  addRecoveryStepSchema,
  cancelRepaymentPlanSchema,
  closeRecoverySchema,
  createRepaymentPlanSchema,
} from "@/server/charges/schemas";

export function OpenRecoveryButton({
  residenceId,
  unitId,
}: {
  residenceId: string;
  unitId: string;
}) {
  const t = useTranslations("charges.recovery");
  return (
    <ConfirmAction
      action={openRecoveryAction}
      input={{ residenceId, unitId }}
      label={t("open")}
      icon={<FolderOpen data-icon="inline-start" />}
      title={t("openTitle")}
      description={t("openDescription")}
      confirmLabel={t("open")}
      successMessage={t("opened")}
      size="sm"
    />
  );
}

/** A step done in the file: what, when, a note. */
export function RecoveryStepDialog({ recoveryId, today }: { recoveryId: string; today: string }) {
  const t = useTranslations("charges.recovery");
  const [open, setOpen] = useState(false);
  const add = useAction(addRecoveryStepAction);
  const form = useForm<
    z.input<typeof addRecoveryStepSchema>,
    unknown,
    z.output<typeof addRecoveryStepSchema>
  >({
    resolver: zodResolver(addRecoveryStepSchema),
    defaultValues: { recoveryId, kind: "formal_notice", doneOn: today, note: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <ListPlus data-icon="inline-start" />
          {t("addStep")}
        </Button>
      }
      title={t("addStep")}
      submitLabel={t("addStep")}
      pending={add.pending}
      onSubmit={form.handleSubmit(() =>
        add.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("stepAdded"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="kind"
          label={t("fields.kind")}
          options={recoveryStepKinds.map((k) => ({ value: k, label: t(`step.${k}`) }))}
        />
        <TextField
          control={form.control}
          name="doneOn"
          label={t("fields.doneOn")}
          type="date"
          dir="ltr"
          max={today}
        />
      </div>
      <TextareaField control={form.control} name="note" label={t("fields.note")} rows={2} />
    </FormDialog>
  );
}

/** Échéancier d'apurement: the arrears over N monthly parts. */
export function RepaymentPlanDialog({
  recoveryId,
  overdue,
  firstDueOn,
}: {
  recoveryId: string;
  /** The overdue amount, as a form value. */
  overdue: string;
  firstDueOn: string;
}) {
  const t = useTranslations("charges.recovery");
  const [open, setOpen] = useState(false);
  const create = useAction(createRepaymentPlanAction);
  const form = useForm<
    z.input<typeof createRepaymentPlanSchema>,
    unknown,
    z.output<typeof createRepaymentPlanSchema>
  >({
    resolver: zodResolver(createRepaymentPlanSchema),
    defaultValues: { recoveryId, total: overdue, months: "6", firstDueOn },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm">
          <CalendarRange data-icon="inline-start" />
          {t("plan")}
        </Button>
      }
      title={t("planTitle")}
      description={t("planDescription")}
      submitLabel={t("planCreate")}
      pending={create.pending}
      onSubmit={form.handleSubmit(() =>
        create.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("planCreated"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          control={form.control}
          name="total"
          label={t("fields.total")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="months"
          label={t("fields.months")}
          inputMode="numeric"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="firstDueOn"
          label={t("fields.firstDueOn")}
          type="date"
          dir="ltr"
        />
      </div>
    </FormDialog>
  );
}

export function CancelPlanDialog({ planId }: { planId: string }) {
  const t = useTranslations("charges.recovery");
  const [open, setOpen] = useState(false);
  const cancel = useAction(cancelRepaymentPlanAction);
  const form = useForm<
    z.input<typeof cancelRepaymentPlanSchema>,
    unknown,
    z.output<typeof cancelRepaymentPlanSchema>
  >({
    resolver: zodResolver(cancelRepaymentPlanSchema),
    defaultValues: { planId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <XCircle data-icon="inline-start" />
          {t("planCancel")}
        </Button>
      }
      title={t("planCancelTitle")}
      description={t("planCancelDescription")}
      submitLabel={t("planCancel")}
      destructive
      pending={cancel.pending}
      onSubmit={form.handleSubmit(() =>
        cancel.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("planCancelled"));
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

export function CloseRecoveryDialog({ recoveryId }: { recoveryId: string }) {
  const t = useTranslations("charges.recovery");
  const [open, setOpen] = useState(false);
  const close = useAction(closeRecoveryAction);
  const form = useForm<
    z.input<typeof closeRecoverySchema>,
    unknown,
    z.output<typeof closeRecoverySchema>
  >({
    resolver: zodResolver(closeRecoverySchema),
    defaultValues: { recoveryId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <FolderClosed data-icon="inline-start" />
          {t("close")}
        </Button>
      }
      title={t("closeTitle")}
      description={t("closeDescription")}
      submitLabel={t("close")}
      destructive
      pending={close.pending}
      onSubmit={form.handleSubmit(() =>
        close.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("closed"));
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
