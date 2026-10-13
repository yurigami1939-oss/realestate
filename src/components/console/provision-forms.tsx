"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { SelectField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { subscriptionPrograms } from "@/lib/subscriptions";
import {
  createProvisionAction,
  resendProvisionAction,
  revokeProvisionAction,
} from "@/server/console/actions";
import { provisionSchema } from "@/server/console/schemas";

/** The link just sent, shown once with a copy button (the token is never kept). */
function SentLink({ url }: { url: string }) {
  const t = useTranslations("console.provisions");
  return (
    <div className="space-y-2 rounded-xl bg-success-soft p-3 text-sm" data-testid="provision-link">
      <p className="font-medium text-success">{t("link")}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-footnote" dir="ltr">
          {url}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(url);
            toast.success(t("copied"));
          }}
        >
          <Copy data-icon="inline-start" />
          {t("copy")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Invites a promoter (CLAUDE.console.md §8): a new client piloting a plan, or — with
 * `billingAccountId` — another SARL of that client's account.
 */
export function ProvisionDialog({
  plans,
  billingAccountId = null,
  defaultEmail = "",
  defaultPlan,
}: {
  plans: { code: string; name: string }[];
  billingAccountId?: string | null;
  defaultEmail?: string;
  /** The plan offered first (the one we push). */
  defaultPlan?: string;
}) {
  const t = useTranslations("console");
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const create = useAction(createProvisionAction);
  const form = useForm<z.input<typeof provisionSchema>, unknown, z.output<typeof provisionSchema>>({
    resolver: zodResolver(provisionSchema),
    defaultValues: {
      email: defaultEmail,
      legalName: "",
      billingAccountId,
      planCode: plans.find((p) => p.code === defaultPlan)?.code ?? plans[0]?.code ?? "",
      program: "standard",
      pilotDays: "",
    },
  });
  const forAccount = billingAccountId !== null;
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSent(null);
      }}
      trigger={
        <Button variant={forAccount ? "outline" : "default"}>
          <Plus data-icon="inline-start" />
          {forAccount ? t("provisions.addOrganization") : t("provisions.create")}
        </Button>
      }
      title={forAccount ? t("provisions.addOrganizationTitle") : t("provisions.createTitle")}
      description={
        forAccount ? t("provisions.addOrganizationDescription") : t("provisions.createDescription")
      }
      submitLabel={forAccount ? t("provisions.addOrganization") : t("provisions.create")}
      pending={create.pending}
      onSubmit={form.handleSubmit(() =>
        create.run(form.getValues(), {
          onSuccess: ({ url }) => {
            toast.success(t("provisions.created"));
            setSent(url);
            form.reset({ ...form.getValues(), email: defaultEmail, legalName: "" });
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      {sent ? <SentLink url={sent} /> : null}
      <TextField
        control={form.control}
        name="email"
        label={t("provisions.email")}
        type="email"
        dir="ltr"
      />
      <TextField control={form.control} name="legalName" label={t("provisions.legalName")} />
      {forAccount ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="planCode"
            label={t("provisions.plan")}
            options={plans.map((p) => ({ value: p.code, label: p.name }))}
          />
          <SelectField
            control={form.control}
            name="program"
            label={t("provisions.program")}
            options={subscriptionPrograms.map((p) => ({ value: p, label: t(`programs.${p}`) }))}
          />
        </div>
      )}
      {forAccount ? null : (
        <TextField
          control={form.control}
          name="pilotDays"
          label={t("provisions.pilotDays")}
          inputMode="numeric"
          dir="ltr"
        />
      )}
    </FormDialog>
  );
}

/** Resend (a new link, the old one withdrawn) and withdraw a provision waiting to be used. */
export function ProvisionActions({ provisionId, email }: { provisionId: string; email: string }) {
  const t = useTranslations("console.provisions");
  const resend = useAction(resendProvisionAction);
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={resend.pending}
        onClick={() =>
          resend.run(
            { provisionId },
            {
              onSuccess: ({ url }) => {
                setSent(url);
                void navigator.clipboard?.writeText(url);
                toast.success(t("resent"));
              },
            },
          )
        }
      >
        {t("resend")}
      </Button>
      <ConfirmAction
        action={revokeProvisionAction}
        input={{ provisionId }}
        label={t("revoke")}
        title={t("revoke")}
        description={t("revokeConfirm", { email })}
        confirmLabel={t("revoke")}
        successMessage={t("revoked")}
        variant="ghost"
        destructive
      />
      {sent ? <span className="sr-only">{sent}</span> : null}
    </div>
  );
}
