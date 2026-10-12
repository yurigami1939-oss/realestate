"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/i18n/navigation";
import { formatDate } from "@/lib/dates";
import type { AppErrorShape } from "@/lib/result";
import {
  type AddonCode,
  addonModules,
  billingPeriods,
  type SubscriptionStatus,
} from "@/lib/subscriptions";
import {
  activateSubscriptionAction,
  addPilotGoalAction,
  changeSubscriptionStatusAction,
  deletePilotGoalAction,
  setSubscriptionAddonAction,
  togglePilotGoalAction,
  updateAccountIdentityAction,
  updateSubscriptionTermsAction,
} from "@/server/console/actions";
import {
  accountIdentitySchema,
  activateSchema,
  statusChangeSchema,
  subscriptionTermsSchema,
} from "@/server/console/schemas";

/** Translates an action's error with its details (a count, a date, a module). */
function useErrorToast() {
  const t = useTranslations();
  return (error: AppErrorShape) => {
    const key = error.messageKey as Parameters<typeof t>[0];
    const details = error.details ?? {};
    const values: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(details)) {
      if (typeof v === "number") values[k] = v;
      else if (typeof v === "string") {
        values[k] = /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? formatDate(v)
          : t.has(`modules.${v}.name` as Parameters<typeof t>[0])
            ? t(`modules.${v}.name` as Parameters<typeof t>[0])
            : v;
      }
    }
    toast.error(t.has(key) ? t(key, values) : t("errors.UNEXPECTED"));
    return true;
  };
}

/** One state change with a reason (suspend, terminate, back to suspended). */
function ReasonDialog({
  billingAccountId,
  to,
  label,
  title,
  description,
  destructive = false,
}: {
  billingAccountId: string;
  to: SubscriptionStatus;
  label: string;
  title: string;
  description: string;
  destructive?: boolean;
}) {
  const t = useTranslations("console.account.status");
  const [open, setOpen] = useState(false);
  const change = useAction(changeSubscriptionStatusAction);
  const onError = useErrorToast();
  const form = useForm<
    z.input<typeof statusChangeSchema>,
    unknown,
    z.output<typeof statusChangeSchema>
  >({
    resolver: zodResolver(statusChangeSchema),
    defaultValues: { billingAccountId, to, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={<Button variant={destructive ? "destructive" : "outline"}>{label}</Button>}
      title={title}
      description={description}
      submitLabel={label}
      destructive={destructive}
      pending={change.pending}
      onSubmit={form.handleSubmit(() =>
        change.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error) || onError(error),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}

/** Activates the subscription: the client chose its plan, its first period starts. */
function ActivateDialog({ billingAccountId, today }: { billingAccountId: string; today: string }) {
  const t = useTranslations("console.account.status");
  const [open, setOpen] = useState(false);
  const activate = useAction(activateSubscriptionAction);
  const onError = useErrorToast();
  const form = useForm<z.input<typeof activateSchema>, unknown, z.output<typeof activateSchema>>({
    resolver: zodResolver(activateSchema),
    defaultValues: { billingAccountId, startsOn: today },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={<Button>{t("activate")}</Button>}
      title={t("activateTitle")}
      description={t("activateDescription")}
      submitLabel={t("activate")}
      pending={activate.pending}
      onSubmit={form.handleSubmit(() =>
        activate.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError,
        }),
      )}
    >
      <TextField
        control={form.control}
        name="startsOn"
        label={t("startsOn")}
        type="date"
        dir="ltr"
      />
    </FormDialog>
  );
}

/**
 * The operator's decisions on a subscription (CLAUDE.console.md §6): activate a pilot, suspend,
 * reactivate, terminate — with a reason when it closes the account.
 */
export function StatusActions({
  billingAccountId,
  status,
  activated,
  today,
}: {
  billingAccountId: string;
  status: SubscriptionStatus;
  activated: boolean;
  today: string;
}) {
  const t = useTranslations("console.account.status");
  const change = useAction(changeSubscriptionStatusAction);
  const onError = useErrorToast();
  const reactivate = () =>
    change.run(
      { billingAccountId, to: "active", reason: "" },
      { onSuccess: () => toast.success(t("done")), onError },
    );
  return (
    <div className="flex flex-wrap gap-2" data-testid="status-actions">
      {(status === "pilot" || status === "past_due") && !activated ? (
        <ActivateDialog billingAccountId={billingAccountId} today={today} />
      ) : null}
      {status === "suspended" ? (
        <Button onClick={reactivate} disabled={change.pending}>
          {t("reactivate")}
        </Button>
      ) : null}
      {status === "pilot" || status === "active" || status === "past_due" ? (
        <ReasonDialog
          billingAccountId={billingAccountId}
          to="suspended"
          label={t("suspend")}
          title={t("suspendTitle")}
          description={t("suspendDescription")}
        />
      ) : null}
      {status === "terminated" ? (
        <ReasonDialog
          billingAccountId={billingAccountId}
          to="suspended"
          label={t("backToSuspended")}
          title={t("backToSuspendedTitle")}
          description={t("suspendDescription")}
        />
      ) : (
        <ReasonDialog
          billingAccountId={billingAccountId}
          to="terminated"
          label={t("terminate")}
          title={t("terminateTitle")}
          description={t("terminateDescription")}
          destructive
        />
      )}
    </div>
  );
}

/** The subscription's terms: plan, period, price, discount, lock, pilot end, grace, caps. */
export function SubscriptionTermsForm({
  defaults,
  plans,
}: {
  defaults: z.input<typeof subscriptionTermsSchema>;
  plans: { code: string; name: string }[];
}) {
  const t = useTranslations("console");
  const save = useAction(updateSubscriptionTermsAction);
  const onError = useErrorToast();
  const form = useForm<
    z.input<typeof subscriptionTermsSchema>,
    unknown,
    z.output<typeof subscriptionTermsSchema>
  >({ resolver: zodResolver(subscriptionTermsSchema), defaultValues: defaults });
  const f = (key: string) => t(`account.subscription.${key}` as Parameters<typeof t>[0]);
  return (
    <form
      noValidate
      data-testid="subscription-terms"
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => toast.success(f("saved")),
          onError: (error) => applyFieldErrors(form, error) || onError(error),
        }),
      )}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="planCode"
            label={f("plan")}
            options={plans.map((p) => ({ value: p.code, label: p.name }))}
          />
          <SelectField
            control={form.control}
            name="billingPeriod"
            label={f("billingPeriod")}
            options={billingPeriods.map((p) => ({ value: p, label: t(`periods.${p}`) }))}
          />
          <TextField
            control={form.control}
            name="price"
            label={f("price")}
            inputMode="decimal"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="discount"
            label={f("discount")}
            inputMode="decimal"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="priceLockedUntil"
            label={f("priceLockedUntil")}
            type="date"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="pilotEndsOn"
            label={f("pilotEndsOn")}
            type="date"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="graceDays"
            label={f("graceDays")}
            inputMode="numeric"
            dir="ltr"
          />
        </div>
        <p className="text-footnote text-muted-foreground">{f("overrides")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            control={form.control}
            name="activeUnits"
            label={f("activeUnits")}
            inputMode="numeric"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="organizations"
            label={f("organizations")}
            inputMode="numeric"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="storageGb"
            label={f("storageGb")}
            inputMode="numeric"
            dir="ltr"
          />
        </div>
        <div>
          <Button type="submit" disabled={save.pending}>
            {f("save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

type AddonRow = {
  code: AddonCode;
  on: boolean;
  price: string;
  since: string | null;
  catalog: string;
};

/** The add-ons: each taken or not (a switch), at its negotiated price (blank = the catalog's). */
export function AddonsEditor({
  billingAccountId,
  rows,
}: {
  billingAccountId: string;
  rows: AddonRow[];
}) {
  const t = useTranslations();
  const set = useAction(setSubscriptionAddonAction);
  const onError = useErrorToast();
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.code, r.price])),
  );
  const run = (code: AddonCode, on: boolean, message: string) =>
    set.run(
      { billingAccountId, code, on, price: prices[code] ?? "" },
      { onSuccess: () => toast.success(message), onError },
    );
  return (
    <ul
      className="divide-y overflow-hidden rounded-xl bg-card shadow-card"
      data-testid="addons-editor"
    >
      {rows.map((row) => (
        <li
          key={row.code}
          className="flex flex-wrap items-center gap-3 px-4 py-3"
          data-addon={row.code}
        >
          <div className="min-w-40 flex-1">
            <div className="text-sm font-medium">{t(`modules.${addonModules[row.code]}.name`)}</div>
            <div className="text-footnote text-muted-foreground">
              {row.catalog}
              {row.on && row.since
                ? ` · ${t("console.account.addons.since", { date: formatDate(row.since) })}`
                : ""}
            </div>
          </div>
          <Input
            value={prices[row.code] ?? ""}
            onChange={(e) => setPrices((p) => ({ ...p, [row.code]: e.target.value }))}
            placeholder={t("console.account.addons.price")}
            aria-label={t("console.account.addons.price")}
            inputMode="decimal"
            dir="ltr"
            className="w-44"
          />
          {row.on ? (
            <Button
              variant="outline"
              size="sm"
              disabled={set.pending}
              onClick={() => run(row.code, true, t("console.account.addons.repriced"))}
            >
              {t("console.account.addons.save")}
            </Button>
          ) : null}
          <Switch
            checked={row.on}
            disabled={set.pending}
            aria-label={t(`modules.${addonModules[row.code]}.name`)}
            onCheckedChange={(on) =>
              run(
                row.code,
                on,
                t(on ? "console.account.addons.taken" : "console.account.addons.dropped"),
              )
            }
          />
        </li>
      ))}
    </ul>
  );
}

/** The goals agreed for the pilot, ticked as they are reached. */
export function PilotGoals({
  billingAccountId,
  goals,
}: {
  billingAccountId: string;
  goals: { id: string; label: string; doneOn: string | null }[];
}) {
  const t = useTranslations("console.account.pilot");
  const router = useRouter();
  const add = useAction(addPilotGoalAction);
  const toggle = useAction(togglePilotGoalAction);
  const remove = useAction(deletePilotGoalAction);
  const onError = useErrorToast();
  const [label, setLabel] = useState("");
  return (
    <div className="space-y-3" data-testid="pilot-goals">
      {goals.length === 0 ? (
        <p className="rounded-xl bg-card px-4 py-3 text-sm text-muted-foreground shadow-card">
          {t("empty")}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-card">
          {goals.map((goal) => (
            <li key={goal.id} className="flex items-center gap-3 px-4 py-3">
              <Checkbox
                checked={goal.doneOn !== null}
                disabled={toggle.pending}
                aria-label={goal.label}
                onCheckedChange={(done) =>
                  toggle.run({ goalId: goal.id, done: done === true }, { onError })
                }
              />
              <div className="min-w-0 flex-1">
                <div
                  className={goal.doneOn ? "text-sm text-muted-foreground line-through" : "text-sm"}
                >
                  {goal.label}
                </div>
                {goal.doneOn ? (
                  <div className="text-footnote text-success">
                    {t("done", { date: formatDate(goal.doneOn) })}
                  </div>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("remove")}
                disabled={remove.pending}
                onClick={() => remove.run({ goalId: goal.id }, { onError })}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          void add.run(
            { billingAccountId, label },
            {
              onSuccess: () => {
                setLabel("");
                toast.success(t("added"));
                router.refresh();
              },
              onError,
            },
          );
        }}
      >
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("label")}
        />
        <Button type="submit" variant="outline" disabled={add.pending || !label.trim()}>
          <Plus data-icon="inline-start" />
          {t("add")}
        </Button>
      </form>
    </div>
  );
}

/** The client's invoicing identity and contact. */
export function AccountIdentityForm({
  defaults,
}: {
  defaults: z.input<typeof accountIdentitySchema>;
}) {
  const t = useTranslations("console.account.identity");
  const save = useAction(updateAccountIdentityAction);
  const onError = useErrorToast();
  const form = useForm<
    z.input<typeof accountIdentitySchema>,
    unknown,
    z.output<typeof accountIdentitySchema>
  >({ resolver: zodResolver(accountIdentitySchema), defaultValues: defaults });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => toast.success(t("saved")),
          onError: (error) => applyFieldErrors(form, error) || onError(error),
        }),
      )}
    >
      <FieldGroup>
        <TextField control={form.control} name="legalName" label={t("legalName")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="address" label={t("address")} />
          <TextField control={form.control} name="wilaya" label={t("wilaya")} />
          <TextField control={form.control} name="rcNumber" label={t("rcNumber")} dir="ltr" />
          <TextField control={form.control} name="nif" label={t("nif")} dir="ltr" />
          <TextField control={form.control} name="nis" label={t("nis")} dir="ltr" />
          <TextField control={form.control} name="aiNumber" label={t("aiNumber")} dir="ltr" />
          <TextField control={form.control} name="contactName" label={t("contactName")} />
          <TextField
            control={form.control}
            name="email"
            label={t("email")}
            type="email"
            dir="ltr"
          />
          <TextField control={form.control} name="phone" label={t("phone")} dir="ltr" />
        </div>
        <TextareaField control={form.control} name="notes" label={t("notes")} rows={3} />
        <div>
          <Button type="submit" disabled={save.pending}>
            {t("save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
