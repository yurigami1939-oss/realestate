"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Megaphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { leadSources } from "@/lib/crm";
import { saveMarketingSpendAction } from "@/server/reports/actions";
import { saveMarketingSpendSchema } from "@/server/reports/schemas";

/** The marketing spend of a month on a lead source (0 removes it). */
export function MarketingSpendDialog({ month }: { month: string }) {
  const t = useTranslations("reports.sources");
  const ts = useTranslations("crm.source");
  const [open, setOpen] = useState(false);
  const save = useAction(saveMarketingSpendAction);
  const form = useForm<
    z.input<typeof saveMarketingSpendSchema>,
    unknown,
    z.output<typeof saveMarketingSpendSchema>
  >({
    resolver: zodResolver(saveMarketingSpendSchema),
    defaultValues: { month, source: "facebook", amount: "", notes: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <Megaphone data-icon="inline-start" />
          {t("spendOpen")}
        </Button>
      }
      title={t("spendTitle")}
      description={t("spendHint")}
      submitLabel={t("spendSave")}
      pending={save.pending}
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("spendSaved"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="month" label={t("month")} type="month" dir="ltr" />
        <SelectField
          control={form.control}
          name="source"
          label={t("source")}
          options={leadSources.map((s) => ({ value: s, label: ts(s) }))}
        />
      </div>
      <TextField
        control={form.control}
        name="amount"
        label={t("amount")}
        inputMode="decimal"
        dir="ltr"
      />
      <TextareaField control={form.control} name="notes" label={t("notes")} rows={2} />
    </FormDialog>
  );
}
