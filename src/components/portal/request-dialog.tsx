"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { portalRequestKinds, requestableCertificates } from "@/lib/requests";
import { createPortalRequestAction } from "@/server/requests/portal-actions";
import { createPortalRequestSchema } from "@/server/requests/schemas";

type Values = z.input<typeof createPortalRequestSchema>;

/** A buyer asks for an attestation, an appointment or anything else about their sale. */
export function PortalRequestDialog({
  reservationId,
  today,
}: {
  reservationId: string;
  today: string;
}) {
  const t = useTranslations("requests");
  const tc = useTranslations("certificates.kind");
  const [open, setOpen] = useState(false);
  const send = useAction(createPortalRequestAction);
  const form = useForm<Values, unknown, z.output<typeof createPortalRequestSchema>>({
    resolver: zodResolver(createPortalRequestSchema),
    defaultValues: {
      reservationId,
      kind: "certificate",
      certificateKind: "payments",
      preferredOn: "",
      message: "",
    },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <MessageSquarePlus data-icon="inline-start" />
          {t("new")}
        </Button>
      }
      title={t("newTitle")}
      description={t("newHint")}
      submitLabel={t("send")}
      pending={send.pending}
      onSubmit={form.handleSubmit(() =>
        send.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("sent"));
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
        label={t("fields.kind")}
        options={portalRequestKinds.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
      />
      {kind === "certificate" ? (
        <SelectField
          control={form.control}
          name="certificateKind"
          label={t("fields.certificateKind")}
          options={requestableCertificates.map((k) => ({ value: k, label: tc(k) }))}
        />
      ) : null}
      {kind === "appointment" ? (
        <TextField
          control={form.control}
          name="preferredOn"
          label={t("fields.preferredOn")}
          type="date"
          dir="ltr"
          min={today}
        />
      ) : null}
      <TextareaField control={form.control} name="message" label={t("fields.message")} rows={3} />
    </FormDialog>
  );
}
