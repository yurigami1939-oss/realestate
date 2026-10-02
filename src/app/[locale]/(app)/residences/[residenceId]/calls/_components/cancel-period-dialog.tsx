"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { cancelChargePeriodAction } from "@/server/charges/actions";
import { cancelChargePeriodSchema } from "@/server/charges/schemas";

type Values = z.input<typeof cancelChargePeriodSchema>;

/** Accountant: voids the calls of a period with a reason. */
export function CancelPeriodDialog({ periodId, period }: { periodId: string; period: string }) {
  const t = useTranslations("charges.calls");
  const [open, setOpen] = useState(false);
  const cancel = useAction(cancelChargePeriodAction);
  const form = useForm<Values, unknown, z.output<typeof cancelChargePeriodSchema>>({
    resolver: zodResolver(cancelChargePeriodSchema),
    defaultValues: { periodId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Ban data-icon="inline-start" />
          {t("cancel")}
        </Button>
      }
      title={t("cancelTitle", { period })}
      description={t("cancelDescription")}
      submitLabel={t("cancel")}
      destructive
      pending={cancel.pending}
      onSubmit={form.handleSubmit(() =>
        cancel.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("cancelled"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("cancelReason")} rows={2} />
    </FormDialog>
  );
}
