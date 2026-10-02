"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { validateMilestoneAction } from "@/server/payment-calls/actions";
import { validateMilestoneSchema } from "@/server/payment-calls/schemas";

type Values = z.input<typeof validateMilestoneSchema>;

/** Records that a milestone is reached: its installments fall due, payment calls are issued. */
export function ValidateMilestoneDialog({
  milestoneId,
  name,
  today,
  delayDays,
}: {
  milestoneId: string;
  name: string;
  today: string;
  delayDays: number;
}) {
  const t = useTranslations("paymentPlans.validate");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const validate = useAction(validateMilestoneAction);
  const form = useForm<Values, unknown, z.output<typeof validateMilestoneSchema>>({
    resolver: zodResolver(validateMilestoneSchema),
    defaultValues: { milestoneId, validatedOn: today },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="mt-0.5">
          <CircleCheck data-icon="inline-start" />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            // Rendered from inside the milestones form: React events bubble through portals.
            event.stopPropagation();
            void form.handleSubmit(() =>
              validate.run(form.getValues(), {
                onSuccess: ({ installments }) => {
                  toast.success(t("done", { count: installments }));
                  setOpen(false);
                },
                onError: (error) => applyFieldErrors(form, error),
              }),
            )(event);
          }}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{t("title", { name })}</DialogTitle>
            <DialogDescription>{t("description", { days: delayDays })}</DialogDescription>
          </DialogHeader>
          <TextField
            control={form.control}
            name="validatedOn"
            label={t("date")}
            type="date"
            dir="ltr"
            max={today}
          />
          <DialogFooter>
            <Button type="submit" disabled={validate.pending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
