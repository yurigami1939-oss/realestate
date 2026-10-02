"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { addDays } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { issueChargePeriodAction } from "@/server/charges/actions";
import type { PeriodToIssue } from "@/server/charges/queries";
import { issueChargePeriodSchema } from "@/server/charges/schemas";

type Values = z.input<typeof issueChargePeriodSchema>;

const valueOf = (p: PeriodToIssue) => `${p.budgetId}:${p.periodIndex}`;

/** Chooses a period still to issue, shows what it will call, issues its calls. */
export function IssueDialog({
  residenceId,
  toIssue,
  today,
  callDueDays,
}: {
  residenceId: string;
  toIssue: PeriodToIssue[];
  today: string;
  callDueDays: number;
}) {
  const t = useTranslations("charges.calls");
  const tp = useTranslations("charges.period");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const issue = useAction(issueChargePeriodAction);
  const first = toIssue[0];
  const form = useForm<Values, unknown, z.output<typeof issueChargePeriodSchema>>({
    resolver: zodResolver(issueChargePeriodSchema),
    defaultValues: {
      period: first ? valueOf(first) : "",
      issuedOn: today,
      dueOn: addDays(today, callDueDays),
    },
  });
  const period = useWatch({ control: form.control, name: "period" });
  const selected = toIssue.find((p) => valueOf(p) === period);
  const label = (p: PeriodToIssue) => tp(p.frequency, { year: p.year, index: p.periodIndex });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Send data-icon="inline-start" className="rtl:rotate-180" />
          {t("issue")}
        </Button>
      }
      title={t("issueTitle")}
      description={t("issueDescription")}
      submitLabel={t("issue")}
      pending={issue.pending}
      onSubmit={form.handleSubmit(() =>
        issue.run(form.getValues(), {
          onSuccess: ({ periodId, calls }) => {
            toast.success(t("issued", { count: calls }));
            setOpen(false);
            router.push(`/residences/${residenceId}/calls/${periodId}`);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="period"
        label={t("fields.period")}
        options={toIssue.map((p) => ({ value: valueOf(p), label: label(p) }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="issuedOn"
          label={t("fields.issuedOn")}
          type="date"
          dir="ltr"
          max={today}
        />
        <TextField
          control={form.control}
          name="dueOn"
          label={t("fields.dueOn")}
          type="date"
          dir="ltr"
        />
      </div>
      {selected ? (
        <div className="space-y-2 text-sm" data-testid="issue-preview">
          <p>
            {t("preview", {
              calls: selected.calls,
              total: formatDZD(selected.total, locale),
              reserve: formatDZD(selected.reserve, locale),
            })}
          </p>
          {selected.withoutCoOwner > 0 ? (
            <p className="text-muted-foreground">
              {t("withoutCoOwner", { count: selected.withoutCoOwner })}
            </p>
          ) : null}
          {selected.problems.length > 0 ? (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-disc ps-4">
                  {selected.problems.map((p) => (
                    <li key={`${p.category ?? "reserve"}-${p.reason}`}>
                      {p.category === null
                        ? t("problem.reserve")
                        : t(`problem.${p.reason}`, { category: p.category })}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </FormDialog>
  );
}
