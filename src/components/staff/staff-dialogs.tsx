"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, LogOut, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { formatAmountInput } from "@/lib/money";
import { chargePaymentMethods, staffRoles } from "@/lib/residences";
import type { AppErrorShape } from "@/lib/result";
import {
  createStaffAction,
  endStaffAction,
  recordAdvanceAction,
  updateStaffAction,
} from "@/server/staff/actions";
import type { StaffRow } from "@/server/staff/queries";
import { createStaffSchema, endStaffSchema, recordAdvanceSchema } from "@/server/staff/schemas";

type StaffValues = z.input<typeof createStaffSchema>;

/** Create (no `agent`) or edit an agent of a residence. */
export function StaffDialog({
  residenceId,
  agent,
  categories,
  today,
}: {
  residenceId: string;
  agent?: StaffRow;
  categories: { id: string; name: string }[];
  today: string;
}) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const create = useAction(createStaffAction);
  const update = useAction(updateStaffAction);
  const form = useForm<StaffValues, unknown, z.output<typeof createStaffSchema>>({
    resolver: zodResolver(createStaffSchema),
    defaultValues: {
      residenceId,
      role: agent?.role ?? "security",
      lastName: agent?.lastName ?? "",
      firstName: agent?.firstName ?? "",
      lastNameAr: agent?.lastNameAr ?? "",
      firstNameAr: agent?.firstNameAr ?? "",
      phone: agent?.phone ?? "",
      nin: agent?.nin ?? "",
      hiredOn: agent?.hiredOn ?? today,
      monthlySalary: agent ? formatAmountInput(agent.monthlySalary) : "",
      categoryId: agent?.categoryId ?? "",
      notes: agent?.notes ?? "",
    },
  });

  function submit() {
    const values = form.getValues();
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (agent) {
      const { residenceId: _r, ...fields } = values;
      return update.run(
        { ...fields, staffId: agent.id },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            setOpen(false);
          },
          onError,
        },
      );
    }
    return create.run(values, {
      onSuccess: () => {
        toast.success(t("created"));
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
        agent ? (
          <Button variant="outline">
            <Pencil data-icon="inline-start" />
            {tc("edit")}
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        )
      }
      title={agent ? t("editTitle") : t("newTitle")}
      submitLabel={agent ? tc("save") : tc("create")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      <SelectField
        control={form.control}
        name="role"
        label={t("fields.role")}
        options={staffRoles.map((r) => ({ value: r, label: t(`role.${r}`) }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="lastName" label={t("fields.lastName")} />
        <TextField control={form.control} name="firstName" label={t("fields.firstName")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="lastNameAr"
          label={t("fields.lastNameAr")}
          dir="rtl"
        />
        <TextField
          control={form.control}
          name="firstNameAr"
          label={t("fields.firstNameAr")}
          dir="rtl"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="phone"
          label={t("fields.phone")}
          type="tel"
          dir="ltr"
        />
        <TextField control={form.control} name="nin" label={t("fields.nin")} dir="ltr" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="hiredOn"
          label={t("fields.hiredOn")}
          type="date"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="monthlySalary"
          label={t("fields.monthlySalary")}
          inputMode="decimal"
          dir="ltr"
        />
      </div>
      <SelectField
        control={form.control}
        name="categoryId"
        label={t("fields.categoryId")}
        emptyLabel={t("noCategory")}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
      />
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

type EndValues = z.input<typeof endStaffSchema>;

/** Records an agent's last day worked. */
export function EndStaffDialog({ staffId, today }: { staffId: string; today: string }) {
  const t = useTranslations("staff");
  const [open, setOpen] = useState(false);
  const end = useAction(endStaffAction);
  const form = useForm<EndValues, unknown, z.output<typeof endStaffSchema>>({
    resolver: zodResolver(endStaffSchema),
    defaultValues: { staffId, leftOn: today },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <LogOut data-icon="inline-start" className="rtl:rotate-180" />
          {t("end")}
        </Button>
      }
      title={t("endTitle")}
      description={t("endDescription")}
      submitLabel={t("end")}
      pending={end.pending}
      onSubmit={form.handleSubmit(() =>
        end.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("ended"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="leftOn"
        label={t("fields.leftOn")}
        type="date"
        dir="ltr"
      />
    </FormDialog>
  );
}

type AdvanceValues = z.input<typeof recordAdvanceSchema>;

/** Salary advance paid to an agent, deducted from a month's pay (this month by default). */
export function AdvanceDialog({
  staffId,
  today,
  accounts = [],
}: {
  staffId: string;
  today: string;
  /** Where the advance can be paid from (« Payé depuis »). */
  accounts?: AccountOption[];
}) {
  const t = useTranslations("staff.advances");
  const tp = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const record = useAction(recordAdvanceAction);
  const form = useForm<AdvanceValues, unknown, z.output<typeof recordAdvanceSchema>>({
    resolver: zodResolver(recordAdvanceSchema),
    defaultValues: {
      staffId,
      paidOn: today,
      month: today.slice(0, 7),
      amount: "",
      method: "cash",
      accountId: "",
      notes: "",
    },
  });
  const method = useWatch({ control: form.control, name: "method" }) ?? "cash";
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Banknote data-icon="inline-start" />
          {t("new")}
        </Button>
      }
      title={t("newTitle")}
      submitLabel={t("record")}
      pending={record.pending}
      onSubmit={form.handleSubmit(() =>
        record.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("recorded"));
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
        <TextField
          control={form.control}
          name="paidOn"
          label={t("fields.paidOn")}
          type="date"
          dir="ltr"
          max={today}
        />
        <TextField
          control={form.control}
          name="month"
          label={t("fields.month")}
          type="month"
          dir="ltr"
        />
      </div>
      <SelectField
        control={form.control}
        name="method"
        label={tp("fields.method")}
        options={chargePaymentMethods.map((m) => ({ value: m, label: tp(`method.${m}`) }))}
      />
      <AccountField
        control={form.control}
        name="accountId"
        method={method}
        accounts={accounts}
        outgoing
      />
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}
