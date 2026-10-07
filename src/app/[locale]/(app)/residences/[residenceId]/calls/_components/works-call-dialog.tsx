"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Hammer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { addDays, formatDate } from "@/lib/dates";
import { issueWorksCallAction } from "@/server/charges/actions";
import { issueWorksCallSchema } from "@/server/charges/schemas";

type Values = z.input<typeof issueWorksCallSchema>;

/**
 * An exceptional call: works voted by the assembly (or any one-off expense), split by a charge
 * category's key and called once.
 */
export function WorksCallDialog({
  residenceId,
  categories,
  resolutions,
  today,
  callDueDays,
}: {
  residenceId: string;
  categories: { id: string; name: string }[];
  resolutions: { id: string; title: string; position: number; heldOn: string }[];
  today: string;
  callDueDays: number;
}) {
  const t = useTranslations("charges.works");
  const tc = useTranslations("charges.calls");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const issue = useAction(issueWorksCallAction);
  const form = useForm<Values, unknown, z.output<typeof issueWorksCallSchema>>({
    resolver: zodResolver(issueWorksCallSchema),
    defaultValues: {
      residenceId,
      title: resolutions[0]?.title ?? "",
      titleAr: "",
      categoryId: categories[0]?.id ?? "",
      amount: "",
      issuedOn: today,
      dueOn: addDays(today, callDueDays),
      resolutionId: resolutions[0]?.id ?? "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Hammer data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={tc("issue")}
      pending={issue.pending}
      onSubmit={form.handleSubmit(() =>
        issue.run(form.getValues(), {
          onSuccess: ({ periodId, calls }) => {
            toast.success(tc("issued", { count: calls }));
            setOpen(false);
            router.push(`/residences/${residenceId}/calls/${periodId}`);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="resolutionId"
        label={t("resolution")}
        emptyLabel={t("noResolution")}
        options={resolutions.map((r) => ({
          value: r.id,
          label: t("resolutionLine", {
            date: formatDate(r.heldOn),
            position: r.position,
            title: r.title,
          }),
        }))}
        onValueChange={(id) => {
          const voted = resolutions.find((r) => r.id === id);
          if (voted) form.setValue("title", voted.title);
        }}
      />
      <TextField control={form.control} name="title" label={t("fields.title")} />
      <TextField control={form.control} name="titleAr" label={t("fields.titleAr")} dir="rtl" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="categoryId"
          label={t("fields.category")}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <TextField
          control={form.control}
          name="amount"
          label={t("fields.amount")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="issuedOn"
          label={tc("fields.issuedOn")}
          type="date"
          dir="ltr"
          max={today}
        />
        <TextField
          control={form.control}
          name="dueOn"
          label={tc("fields.dueOn")}
          type="date"
          dir="ltr"
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
    </FormDialog>
  );
}
