"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { addDays } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { issueChargeReminderAction } from "@/server/charges/actions";
import { issueChargeReminderSchema } from "@/server/charges/schemas";

type Values = z.input<typeof issueChargeReminderSchema>;

/** Reminder letter for a unit's overdue charges, with the date asked for payment (8 days). */
export function ChargeReminderDialog({
  residenceId,
  unitId,
  code,
  overdue,
  today,
  compact = false,
}: {
  residenceId: string;
  unitId: string;
  code: string;
  overdue: bigint;
  today: string;
  compact?: boolean;
}) {
  const t = useTranslations("charges.reminder");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const issue = useAction(issueChargeReminderAction);
  const form = useForm<Values, unknown, z.output<typeof issueChargeReminderSchema>>({
    resolver: zodResolver(issueChargeReminderSchema),
    defaultValues: { residenceId, unitId, payBy: addDays(today, 8) },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant={compact ? "ghost" : "outline"} size={compact ? "sm" : "default"}>
          <Mail data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title", { code })}
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
