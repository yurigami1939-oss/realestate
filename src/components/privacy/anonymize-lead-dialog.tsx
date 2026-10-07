"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserX } from "lucide-react";
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
import { anonymizeLeadAction } from "@/server/privacy/actions";
import { anonymizeLeadSchema } from "@/server/privacy/schemas";

/** Erases a prospect at their request (Loi 18-07): personal data removed, statistics kept. */
export function AnonymizeLeadDialog({ leadId }: { leadId: string }) {
  const t = useTranslations("privacy");
  const [open, setOpen] = useState(false);
  const erase = useAction(anonymizeLeadAction);
  const form = useForm<
    z.input<typeof anonymizeLeadSchema>,
    unknown,
    z.output<typeof anonymizeLeadSchema>
  >({
    resolver: zodResolver(anonymizeLeadSchema),
    defaultValues: { leadId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <UserX data-icon="inline-start" />
          {t("anonymize")}
        </Button>
      }
      title={t("anonymizeTitle")}
      description={t("anonymizeDescription")}
      submitLabel={t("anonymize")}
      destructive
      pending={erase.pending}
      onSubmit={form.handleSubmit(() =>
        erase.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("anonymized"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}
