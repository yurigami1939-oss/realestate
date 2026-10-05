"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileBadge } from "lucide-react";
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
import type { CertificateKind } from "@/lib/certificates";
import { issueCertificateAction } from "@/server/certificates/actions";
import { issueCertificateSchema } from "@/server/certificates/schemas";

type Values = z.input<typeof issueCertificateSchema>;

/**
 * Issues a certificate of the sale (attestation, statement of account), optionally addressed
 * to a bank; only the kinds the sale allows today are offered.
 */
export function IssueCertificateDialog({
  reservationId,
  kinds,
}: {
  reservationId: string;
  kinds: CertificateKind[];
}) {
  const t = useTranslations("certificates");
  const [open, setOpen] = useState(false);
  const issue = useAction(issueCertificateAction);
  const form = useForm<Values, unknown, z.output<typeof issueCertificateSchema>>({
    resolver: zodResolver(issueCertificateSchema),
    defaultValues: { reservationId, kind: kinds[0] ?? "statement", addressee: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <FileBadge data-icon="inline-start" />
          {t("issue")}
        </Button>
      }
      title={t("issueTitle")}
      description={t("issueDescription")}
      submitLabel={t("issue")}
      pending={issue.pending}
      onSubmit={form.handleSubmit(() =>
        issue.run(form.getValues(), {
          onSuccess: ({ number }) => {
            toast.success(t("issued", { number }));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="kind"
        label={t("kindLabel")}
        options={kinds.map((kind) => ({ value: kind, label: t(`kind.${kind}`) }))}
      />
      <TextField
        control={form.control}
        name="addressee"
        label={t("addressee")}
        description={t("addresseeHelp")}
        maxLength={160}
      />
    </FormDialog>
  );
}
