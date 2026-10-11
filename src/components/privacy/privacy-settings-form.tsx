"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import type { PrivacySettings } from "@/lib/privacy";
import { savePrivacySettingsAction } from "@/server/privacy/actions";
import { privacySettingsSchema } from "@/server/privacy/schemas";

type Values = z.input<typeof privacySettingsSchema>;

/** The retention periods the daily job applies (0 or blank = off). */
export function PrivacySettingsForm({ current }: { current: PrivacySettings }) {
  const t = useTranslations("privacy.settings");
  const save = useAction(savePrivacySettingsAction);
  const months = (v: number) => (v === 0 ? "" : String(v));
  const form = useForm<Values, unknown, z.output<typeof privacySettingsSchema>>({
    resolver: zodResolver(privacySettingsSchema),
    defaultValues: {
      leadRetentionMonths: months(current.leadRetentionMonths),
      messageRetentionMonths: months(current.messageRetentionMonths),
      visitorRetentionMonths: months(current.visitorRetentionMonths),
    },
  });
  return (
    <Card>
      <CardContent>
        <form
          onSubmit={form.handleSubmit(() =>
            save.run(form.getValues(), {
              onSuccess: () => toast.success(t("saved")),
              onError: (error) => applyFieldErrors(form, error),
            }),
          )}
          noValidate
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="leadRetentionMonths"
                label={t("leadRetentionMonths")}
                description={t("leadRetentionHint")}
                inputMode="numeric"
                placeholder="0"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="messageRetentionMonths"
                label={t("messageRetentionMonths")}
                description={t("messageRetentionHint")}
                inputMode="numeric"
                placeholder="0"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="visitorRetentionMonths"
                label={t("visitorRetentionMonths")}
                description={t("visitorRetentionHint")}
                inputMode="numeric"
                placeholder="0"
                dir="ltr"
              />
            </div>
            <div>
              <Button type="submit" disabled={save.pending}>
                {t("save")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
