"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Send, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import {
  CheckboxField,
  CheckboxGroupField,
  SelectField,
  TextareaField,
} from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { smsProviders, type SmsStatus, smsStatuses } from "@/lib/sms";
import { cn } from "@/lib/utils";
import { whatsappKinds, whatsappLanguages } from "@/lib/whatsapp";
import {
  addSmsOptOutAction,
  removeSmsOptOutAction,
  saveSmsSettingsAction,
  sendTestSmsAction,
} from "@/server/sms/actions";
import { smsOptOutSchema, smsSettingsSchema, testSmsSchema } from "@/server/sms/schemas";

const badge =
  "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap";

const statusClasses: Record<SmsStatus, string> = {
  queued: "border-warning/25 bg-warning-soft text-warning",
  sent: "border-success/25 bg-success-soft text-success",
  failed: "border-danger/25 bg-danger-soft text-danger",
};

export function SmsStatusBadge({ status }: { status: SmsStatus }) {
  const t = useTranslations("sms.status");
  return <span className={cn(badge, statusClasses[status])}>{t(status)}</span>;
}

const ALL = "__all__";

/** Status and kind of message, kept in the URL. */
export function SmsLogFilters() {
  const t = useTranslations("sms");
  const tw = useTranslations("whatsapp");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={params.get("status") || ALL}
        onValueChange={(value) => params.set({ status: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-48" aria-label={t("filters.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.allStatuses")}</SelectItem>
          {smsStatuses.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`status.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={params.get("kind") || ALL}
        onValueChange={(value) => params.set({ kind: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-64" aria-label={t("filters.kind")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.allKinds")}</SelectItem>
          {whatsappKinds.map((k) => (
            <SelectItem key={k} value={k}>
              {tw(`kind.${k}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type SettingsValues = z.input<typeof smsSettingsSchema>;

/** The organization's SMS account: gateway, sender, key (never shown), notifications. */
export function SmsSettingsForm({
  current,
  hasKey,
}: {
  current: Omit<SettingsValues, "apiKey"> | null;
  hasKey: boolean;
}) {
  const t = useTranslations("sms.settings");
  const tw = useTranslations("whatsapp");
  const save = useAction(saveSmsSettingsAction);
  const form = useForm<SettingsValues, unknown, z.output<typeof smsSettingsSchema>>({
    resolver: zodResolver(smsSettingsSchema),
    defaultValues: {
      enabled: current?.enabled ?? false,
      provider: current?.provider ?? "mobilis",
      apiUrl: current?.apiUrl ?? "",
      sender: current?.sender ?? "",
      apiKey: "",
      language: current?.language ?? "fr",
      kinds: current?.kinds ?? [],
    },
  });
  return (
    <Card>
      <CardContent>
        <form
          onSubmit={form.handleSubmit(() =>
            save.run(form.getValues(), {
              onSuccess: () => {
                toast.success(t("saved"));
                form.setValue("apiKey", "");
              },
              onError: (error) => applyFieldErrors(form, error),
            }),
          )}
          noValidate
        >
          <FieldGroup>
            <CheckboxField control={form.control} name="enabled" label={t("enabled")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="provider"
                label={t("provider")}
                options={smsProviders.map((p) => ({ value: p, label: t(`providers.${p}`) }))}
              />
              <TextField
                control={form.control}
                name="sender"
                label={t("sender")}
                description={t("senderHint")}
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="apiUrl"
                label={t("apiUrl")}
                description={t("apiUrlHint")}
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="apiKey"
                label={t("apiKey")}
                description={hasKey ? t("apiKeySaved") : undefined}
                type="password"
                autoComplete="off"
                dir="ltr"
              />
              <SelectField
                control={form.control}
                name="language"
                label={t("language")}
                options={whatsappLanguages.map((l) => ({ value: l, label: tw(`language.${l}`) }))}
              />
            </div>
            <CheckboxGroupField
              control={form.control}
              name="kinds"
              label={t("kinds")}
              options={whatsappKinds.map((k) => ({ value: k, label: tw(`kind.${k}`) }))}
            />
            <p className="text-sm text-muted-foreground">{t("kindsHint")}</p>
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

/** A test message to one number (the account must be on). */
export function TestSmsDialog() {
  const t = useTranslations("sms.test");
  const [open, setOpen] = useState(false);
  const send = useAction(sendTestSmsAction);
  const form = useForm<z.input<typeof testSmsSchema>, unknown, z.output<typeof testSmsSchema>>({
    resolver: zodResolver(testSmsSchema),
    defaultValues: { phone: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <Send data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      pending={send.pending}
      onSubmit={form.handleSubmit(() =>
        send.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("sent"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="phone" label={t("phone")} dir="ltr" />
    </FormDialog>
  );
}

/** A number that asked for no more SMS (« STOP » by phone, at the counter…). */
export function SmsOptOutDialog({ phone = "" }: { phone?: string }) {
  const t = useTranslations("sms.optOut");
  const [open, setOpen] = useState(false);
  const add = useAction(addSmsOptOutAction);
  const form = useForm<z.input<typeof smsOptOutSchema>, unknown, z.output<typeof smsOptOutSchema>>({
    resolver: zodResolver(smsOptOutSchema),
    defaultValues: { phone, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <Ban data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      pending={add.pending}
      onSubmit={form.handleSubmit(() =>
        add.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("added"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="phone" label={t("phone")} dir="ltr" />
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}

/** Takes a number off the list: the person agrees to SMS again. */
export function RemoveSmsOptOutButton({ optOutId }: { optOutId: string }) {
  const t = useTranslations("sms.optOut");
  const remove = useAction(removeSmsOptOutAction);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={remove.pending}
      onClick={() =>
        void remove.run({ optOutId }, { onSuccess: () => toast.success(t("removed")) })
      }
    >
      <Undo2 data-icon="inline-start" />
      {t("remove")}
    </Button>
  );
}
