"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, TextareaField } from "@/components/forms/fields";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parsePercentToBasisPoints } from "@/lib/money";
import { FULL_SHARE_BP, formatShare, planStepTriggers } from "@/lib/payment-plans";
import { cn } from "@/lib/utils";
import { createPaymentPlanAction, updatePaymentPlanAction } from "@/server/payment-plans/actions";
import { createPaymentPlanSchema } from "@/server/payment-plans/schemas";
import type { PaymentPlanWithSteps } from "@/server/payment-plans/queries";

type Values = z.input<typeof createPaymentPlanSchema>;
type Milestone = { id: string; name: string };

const shareInput = (bp: number) => (bp / 100).toString().replace(".", ",");

const emptyStep: Values["steps"][number] = {
  label: "",
  share: "",
  trigger: "signing",
  months: "",
  milestoneId: "",
};

/** Create (no `plan`) or edit a payment plan and its steps; the total must reach 100 %. */
export function PlanDialog({
  projectId,
  milestones,
  plan,
}: {
  projectId: string;
  milestones: Milestone[];
  plan?: PaymentPlanWithSteps;
}) {
  const t = useTranslations("paymentPlans");
  const tc = useTranslations("common");
  const translate = useTranslateKey();
  const [open, setOpen] = useState(false);
  const create = useAction(createPaymentPlanAction);
  const update = useAction(updatePaymentPlanAction);
  const form = useForm<Values, unknown, z.output<typeof createPaymentPlanSchema>>({
    resolver: zodResolver(createPaymentPlanSchema),
    defaultValues: {
      projectId,
      name: plan?.name ?? "",
      isDefault: plan?.isDefault ?? false,
      notes: plan?.notes ?? "",
      steps: plan
        ? plan.steps.map((s) => ({
            label: s.label,
            share: shareInput(s.shareBp),
            trigger: s.trigger,
            months: s.months !== null ? String(s.months) : "",
            milestoneId: s.milestoneId ?? "",
          }))
        : [
            { ...emptyStep, label: t("defaultSteps.signing"), share: "20" },
            { ...emptyStep, label: t("defaultSteps.handover"), share: "80" },
          ],
    },
  });
  const steps = useFieldArray({ control: form.control, name: "steps" });
  const watched = useWatch({ control: form.control, name: "steps" });
  const total = watched.reduce(
    (sum, s) => sum + Number(parsePercentToBasisPoints(s.share ?? "") ?? 0n),
    0,
  );
  const stepsError =
    form.formState.errors.steps?.root?.message ?? form.formState.errors.steps?.message;

  async function onSubmit(values: Values) {
    const done = (message: string) => {
      toast.success(message);
      setOpen(false);
    };
    const onError = (error: Parameters<typeof applyFieldErrors>[1]) =>
      applyFieldErrors(form, error);
    if (plan) {
      const { projectId: _projectId, ...rest } = values;
      await update.run(
        { ...rest, planId: plan.id },
        { onSuccess: () => done(t("updated")), onError },
      );
    } else {
      await create.run(values, {
        onSuccess: () => {
          done(t("created"));
          form.reset();
        },
        onError,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {plan ? (
          <Button variant="outline" size="sm">
            <Pencil data-icon="inline-start" />
            {t("edit")}
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{plan ? t("editTitle", { name: plan.name }) : t("newTitle")}</DialogTitle>
        </DialogHeader>
        <form
          id="plan-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
          className="max-h-[70vh] overflow-y-auto pe-1"
        >
          <FieldGroup>
            <TextField control={form.control} name="name" label={t("name")} />
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("steps")}</p>
              {steps.fields.map((row, index) => {
                const trigger = watched[index]?.trigger ?? "signing";
                const err = form.formState.errors.steps?.[index];
                return (
                  <div
                    key={row.id}
                    className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_6rem_12rem_10rem_auto]"
                    data-testid="plan-step"
                  >
                    <Controller
                      control={form.control}
                      name={`steps.${index}.label`}
                      render={({ field }) => (
                        <Input
                          {...field}
                          aria-label={`${t("step.label")} ${index + 1}`}
                          aria-invalid={Boolean(err?.label)}
                          placeholder={t("step.label")}
                        />
                      )}
                    />
                    <Controller
                      control={form.control}
                      name={`steps.${index}.share`}
                      render={({ field }) => (
                        <Input
                          {...field}
                          aria-label={`${t("step.share")} ${index + 1}`}
                          aria-invalid={Boolean(err?.share)}
                          placeholder="%"
                          inputMode="decimal"
                          dir="ltr"
                        />
                      )}
                    />
                    <Controller
                      control={form.control}
                      name={`steps.${index}.trigger`}
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger
                            className="w-full"
                            aria-label={`${t("step.trigger")} ${index + 1}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {planStepTriggers.map((v) => (
                              <SelectItem key={v} value={v}>
                                {t(`trigger.${v}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {trigger === "months_after_signing" ? (
                      <Controller
                        control={form.control}
                        name={`steps.${index}.months`}
                        render={({ field }) => (
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            aria-label={`${t("step.months")} ${index + 1}`}
                            aria-invalid={Boolean(err?.months)}
                            placeholder={t("step.months")}
                            inputMode="numeric"
                            dir="ltr"
                          />
                        )}
                      />
                    ) : trigger === "milestone" ? (
                      <Controller
                        control={form.control}
                        name={`steps.${index}.milestoneId`}
                        render={({ field }) => (
                          <Select value={field.value || undefined} onValueChange={field.onChange}>
                            <SelectTrigger
                              className={cn("w-full", err?.milestoneId && "border-destructive")}
                              aria-label={`${t("step.milestoneId")} ${index + 1}`}
                            >
                              <SelectValue placeholder={t("step.milestoneId")} />
                            </SelectTrigger>
                            <SelectContent>
                              {milestones.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    ) : (
                      <span />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => steps.remove(index)}
                      aria-label={t("removeStep")}
                    >
                      <X />
                    </Button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => steps.append({ ...emptyStep })}
                >
                  <Plus data-icon="inline-start" />
                  {t("addStep")}
                </Button>
                <span
                  className={cn(
                    "text-sm font-medium",
                    total === FULL_SHARE_BP ? "text-emerald-700" : "text-rose-700",
                  )}
                  data-testid="plan-total"
                >
                  {t("total", { total: formatShare(total) })}
                </span>
              </div>
              {stepsError ? (
                <p className="text-sm text-destructive">{translate(stepsError)}</p>
              ) : null}
            </div>
            <TextareaField control={form.control} name="notes" label={t("notes")} rows={2} />
            <CheckboxField control={form.control} name="isDefault" label={t("isDefault")} />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="plan-form" disabled={create.pending || update.pending}>
            {plan ? tc("save") : tc("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
