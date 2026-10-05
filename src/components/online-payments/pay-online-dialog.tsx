"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreditCard } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Link } from "@/i18n/navigation";
import type { OnlinePaymentPurpose } from "@/lib/online-payments";
import { startOnlinePaymentAction } from "@/server/online-payments/portal-actions";
import { startOnlinePaymentSchema } from "@/server/online-payments/schemas";

import { CardsMark } from "./badges";

type Values = z.input<typeof startOnlinePaymentSchema>;

/**
 * « Payer en ligne »: the amount (what is due by default, never above the remaining balance) and
 * the conditions, then the browser goes to SATIM's payment page (CLAUDE.md §7 Online payment).
 */
export function PayOnlineDialog({
  purpose,
  targetId,
  suggested,
  remaining,
  test,
}: {
  purpose: OnlinePaymentPurpose;
  targetId: string;
  /** Default amount, as typed in the field ("12 500,00"). */
  suggested: string;
  /** Remaining balance, formatted. */
  remaining: string;
  /** SATIM's test platform: no card is debited. */
  test: boolean;
}) {
  const t = useTranslations("portal.pay");
  const translate = useTranslateKey();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pending, setPending] = useState(false);
  const form = useForm<Values, unknown, z.output<typeof startOnlinePaymentSchema>>({
    resolver: zodResolver(startOnlinePaymentSchema),
    defaultValues: { purpose, targetId, amount: suggested, acceptTerms: false },
  });

  const submit = form.handleSubmit(async () => {
    setPending(true);
    const result = await startOnlinePaymentAction(form.getValues());
    if (result.ok) {
      setLeaving(true);
      window.location.assign(result.data.formUrl);
      return;
    }
    setPending(false);
    if (!applyFieldErrors(form, result.error)) {
      form.setError("root", { message: result.error.messageKey });
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm">
          <CreditCard data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={leaving ? t("redirecting") : t("submit")}
      pending={pending || leaving}
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CardsMark />
        {test ? <span className="text-sm text-violet-800">{t("testMode")}</span> : null}
      </div>
      <TextField
        control={form.control}
        name="amount"
        label={t("amount")}
        description={t("amountHint", { amount: remaining })}
        inputMode="decimal"
        dir="ltr"
      />
      <Controller
        control={form.control}
        name="acceptTerms"
        render={({ field, fieldState }) => (
          <Field orientation="horizontal" data-invalid={fieldState.invalid}>
            <Checkbox
              id="acceptTerms"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
              aria-invalid={fieldState.invalid}
            />
            <div className="space-y-1">
              <FieldLabel htmlFor="acceptTerms" className="font-normal">
                {t("terms")}
              </FieldLabel>
              <Link
                href="/portal/payment-terms"
                target="_blank"
                className="text-sm text-muted-foreground underline underline-offset-4"
              >
                {t("readTerms")}
              </Link>
              {fieldState.error?.message ? (
                <FieldError errors={[{ message: translate(fieldState.error.message) }]} />
              ) : null}
            </div>
          </Field>
        )}
      />
      {form.formState.errors.root?.message ? (
        <p role="alert" className="text-sm text-destructive">
          {translate(form.formState.errors.root.message)}
        </p>
      ) : null}
    </FormDialog>
  );
}
