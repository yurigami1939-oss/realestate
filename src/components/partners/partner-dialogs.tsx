"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, Handshake, Pencil } from "lucide-react";
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
import { AccountField, type AccountOption } from "@/components/treasury/account-field";
import { Button } from "@/components/ui/button";
import { partnerKinds } from "@/lib/partners";
import { counterPaymentMethods } from "@/lib/sales";
import {
  createPartnerAction,
  payPartnerCommissionAction,
  updatePartnerAction,
} from "@/server/partners/actions";
import { createPartnerSchema, payPartnerCommissionSchema } from "@/server/partners/schemas";

type Values = z.input<typeof createPartnerSchema>;

/** A new agency or introducer, or one corrected (`partnerId` and its values). */
export function PartnerDialog({ partnerId, values }: { partnerId?: string; values?: Values }) {
  const t = useTranslations("partners");
  const [open, setOpen] = useState(false);
  const create = useAction(createPartnerAction);
  const update = useAction(updatePartnerAction);
  const form = useForm<Values, unknown, z.output<typeof createPartnerSchema>>({
    resolver: zodResolver(createPartnerSchema),
    defaultValues: values ?? {
      kind: "agency",
      name: "",
      contactName: "",
      phone: "",
      email: "",
      nif: "",
      rcNumber: "",
      commissionRate: "1",
      notes: "",
    },
  });
  const done = (message: string) => {
    toast.success(message);
    setOpen(false);
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        partnerId ? (
          <Button variant="ghost" size="sm">
            <Pencil data-icon="inline-start" />
            {t("edit")}
          </Button>
        ) : (
          <Button>
            <Handshake data-icon="inline-start" />
            {t("new")}
          </Button>
        )
      }
      title={partnerId ? t("editTitle") : t("newTitle")}
      submitLabel={partnerId ? t("save") : t("new")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(() => {
        const raw = form.getValues();
        const onError = (error: Parameters<typeof applyFieldErrors>[1]) =>
          applyFieldErrors(form, error);
        if (partnerId) {
          void update.run({ ...raw, partnerId }, { onSuccess: () => done(t("saved")), onError });
        } else {
          void create.run(raw, {
            onSuccess: () => {
              done(t("created"));
              form.reset();
            },
            onError,
          });
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="kind"
          label={t("fields.kind")}
          options={partnerKinds.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
        />
        <TextField control={form.control} name="name" label={t("fields.name")} />
        <TextField control={form.control} name="contactName" label={t("fields.contactName")} />
        <TextField control={form.control} name="phone" label={t("fields.phone")} dir="ltr" />
        <TextField control={form.control} name="email" label={t("fields.email")} dir="ltr" />
        <TextField
          control={form.control}
          name="commissionRate"
          label={t("fields.commissionRate")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField control={form.control} name="nif" label={t("fields.nif")} dir="ltr" />
        <TextField control={form.control} name="rcNumber" label={t("fields.rcNumber")} dir="ltr" />
      </div>
      <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />
    </FormDialog>
  );
}

/** Accountant: an earned partner commission paid out, from an account. */
export function PayPartnerCommissionDialog({
  commissionId,
  today,
  accounts,
}: {
  commissionId: string;
  today: string;
  accounts: AccountOption[];
}) {
  const t = useTranslations("partners");
  const tp = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const pay = useAction(payPartnerCommissionAction);
  const form = useForm<
    z.input<typeof payPartnerCommissionSchema>,
    unknown,
    z.output<typeof payPartnerCommissionSchema>
  >({
    resolver: zodResolver(payPartnerCommissionSchema),
    defaultValues: { commissionId, paidOn: today, method: "bank_transfer", accountId: "" },
  });
  const method = useWatch({ control: form.control, name: "method" });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <Banknote data-icon="inline-start" />
          {t("pay")}
        </Button>
      }
      title={t("payTitle")}
      submitLabel={t("pay")}
      pending={pay.pending}
      onSubmit={form.handleSubmit(() =>
        pay.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("paid"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="paidOn"
          label={t("fields.paidOn")}
          type="date"
          dir="ltr"
          max={today}
        />
        <SelectField
          control={form.control}
          name="method"
          label={tp("fields.method")}
          options={counterPaymentMethods.map((m) => ({ value: m, label: tp(`method.${m}`) }))}
        />
      </div>
      <AccountField
        control={form.control}
        name="accountId"
        method={method}
        accounts={accounts}
        outgoing
      />
    </FormDialog>
  );
}
