"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Headset } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { startSupportSessionAction } from "@/server/console/actions";
import { supportStartSchema } from "@/server/console/schemas";

/**
 * Opens a support session on one organization of the account (CLAUDE.console.md §12): one of its
 * staff (the gérant first) and a reason; the browser then lands on its dashboard, read-only.
 */
export function SupportDialog({
  organization,
  members,
}: {
  organization: { id: string; name: string };
  members: { userId: string; name: string; email: string }[];
}) {
  const t = useTranslations("console.account.support");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const start = useAction(startSupportSessionAction);
  const form = useForm<
    z.input<typeof supportStartSchema>,
    unknown,
    z.output<typeof supportStartSchema>
  >({
    resolver: zodResolver(supportStartSchema),
    defaultValues: {
      organizationId: organization.id,
      userId: members[0]?.userId ?? "",
      reason: "",
    },
  });
  if (members.length === 0) return null;
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm" data-testid="support-open">
          <Headset data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description", { organization: organization.name })}
      submitLabel={t("submit")}
      pending={start.pending}
      onSubmit={form.handleSubmit(() =>
        start.run(form.getValues(), {
          onSuccess: () => {
            router.replace("/dashboard");
            router.refresh();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="userId"
        label={t("member")}
        options={members.map((m) => ({ value: m.userId, label: `${m.name} · ${m.email}` }))}
      />
      <TextareaField control={form.control} name="reason" label={t("reason")} />
    </FormDialog>
  );
}
