"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, CalendarClock, Check, KeyRound, Pencil, Plus, Stamp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { type FieldValues, type UseFormReturn, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxGroupField, SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { punchTrades } from "@/lib/handovers";
import type { AppErrorShape } from "@/lib/result";
import {
  addPunchItemAction,
  cancelPunchItemAction,
  closeReservesAction,
  liftPunchItemAction,
  recordPastDeliveriesAction,
  scheduleHandoverAction,
  signHandoverAction,
  updatePunchItemAction,
} from "@/server/handovers/actions";
import type { PastDeliveryUnit } from "@/server/handovers/queries";
import {
  addPunchItemSchema,
  cancelPunchItemSchema,
  closeReservesSchema,
  liftPunchItemSchema,
  pastDeliveriesSchema,
  scheduleHandoverSchema,
  signHandoverSchema,
} from "@/server/handovers/schemas";

/** Field errors from the server land on the form; other errors are toasted. */
const fieldErrors =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any context/output types
  <T extends FieldValues>(form: UseFormReturn<T, any, any>) =>
    (error: AppErrorShape) =>
      applyFieldErrors(form, error);

// ── Appointment ─────────────────────────────────────────────────────────────

type ScheduleValues = z.input<typeof scheduleHandoverSchema>;

/** Plans the handover appointment of a sold unit, or moves it. */
export function ScheduleHandoverDialog({
  reservationId,
  scheduledAt,
  notes,
  defaultAt,
}: {
  reservationId: string;
  /** Current appointment (datetime-local value), if any. */
  scheduledAt: string | null;
  notes: string | null;
  /** Proposed when nothing is planned yet. */
  defaultAt: string;
}) {
  const t = useTranslations("handovers.schedule");
  const [open, setOpen] = useState(false);
  const run = useAction(scheduleHandoverAction);
  const form = useForm<ScheduleValues, unknown, z.output<typeof scheduleHandoverSchema>>({
    resolver: zodResolver(scheduleHandoverSchema),
    defaultValues: { reservationId, scheduledAt: scheduledAt ?? defaultAt, notes: notes ?? "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant={scheduledAt ? "outline" : "default"}>
          <CalendarClock data-icon="inline-start" />
          {scheduledAt ? t("move") : t("open")}
        </Button>
      }
      title={scheduledAt ? t("moveTitle") : t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      pending={run.pending}
      onSubmit={form.handleSubmit(() =>
        run.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="scheduledAt"
        label={t("at")}
        type="datetime-local"
        dir="ltr"
      />
      <TextareaField control={form.control} name="notes" label={t("notes")} rows={3} />
    </FormDialog>
  );
}

// ── Reserves ────────────────────────────────────────────────────────────────

type PunchValues = z.input<typeof addPunchItemSchema>;

export type EditablePunchItem = {
  id: string;
  location: string;
  description: string;
  trade: (typeof punchTrades)[number];
  dueOn: string | null;
};

/** Records a reserve (no `item`) or corrects one not yet printed on a PV. */
export function PunchItemDialog({
  handoverId,
  item,
}: {
  handoverId: string;
  item?: EditablePunchItem;
}) {
  const t = useTranslations("handovers.reserve");
  const tt = useTranslations("handovers.trade");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const add = useAction(addPunchItemAction);
  const update = useAction(updatePunchItemAction);
  const form = useForm<PunchValues, unknown, z.output<typeof addPunchItemSchema>>({
    resolver: zodResolver(addPunchItemSchema),
    defaultValues: {
      handoverId,
      location: item?.location ?? "",
      description: item?.description ?? "",
      trade: item?.trade ?? "other",
      dueOn: item?.dueOn ?? "",
    },
  });
  function submit() {
    const values = form.getValues();
    if (item) {
      const { handoverId: _h, ...fields } = values;
      return update.run(
        { ...fields, punchItemId: item.id },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        },
      );
    }
    return add.run(values, {
      onSuccess: () => {
        toast.success(t("added"));
        form.reset({ ...values, location: "", description: "" });
        setOpen(false);
      },
      onError: fieldErrors(form),
    });
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        item ? (
          <Button variant="ghost" size="sm">
            <Pencil data-icon="inline-start" />
            {tc("edit")}
          </Button>
        ) : (
          <Button variant="outline">
            <Plus data-icon="inline-start" />
            {t("add")}
          </Button>
        )
      }
      title={item ? t("editTitle") : t("addTitle")}
      description={item ? undefined : t("addDescription")}
      submitLabel={item ? tc("save") : t("add")}
      pending={add.pending || update.pending}
      onSubmit={form.handleSubmit(submit)}
    >
      <TextField control={form.control} name="location" label={t("location")} />
      <TextareaField control={form.control} name="description" label={t("description")} />
      <SelectField
        control={form.control}
        name="trade"
        label={t("trade")}
        options={punchTrades.map((trade) => ({ value: trade, label: tt(trade) }))}
      />
      <TextField
        control={form.control}
        name="dueOn"
        label={t("dueOn")}
        description={t("dueOnHint")}
        type="date"
        dir="ltr"
      />
    </FormDialog>
  );
}

type LiftValues = z.input<typeof liftPunchItemSchema>;

/** Records that a reserve's works are done. */
export function LiftPunchItemDialog({
  punchItemId,
  position,
  today,
}: {
  punchItemId: string;
  position: number;
  today: string;
}) {
  const t = useTranslations("handovers.lift");
  const [open, setOpen] = useState(false);
  const run = useAction(liftPunchItemAction);
  const form = useForm<LiftValues, unknown, z.output<typeof liftPunchItemSchema>>({
    resolver: zodResolver(liftPunchItemSchema),
    defaultValues: { punchItemId, liftedOn: today, note: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm" aria-label={t("openLabel", { position })}>
          <Check data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title", { position })}
      submitLabel={t("submit")}
      pending={run.pending}
      onSubmit={form.handleSubmit(() =>
        run.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="liftedOn"
        label={t("date")}
        type="date"
        dir="ltr"
        max={today}
      />
      <TextareaField control={form.control} name="note" label={t("note")} rows={2} />
    </FormDialog>
  );
}

type CancelValues = z.input<typeof cancelPunchItemSchema>;

/** Cancels a reserve (recorded by mistake, not accepted as a defect). */
export function CancelPunchItemDialog({
  punchItemId,
  position,
}: {
  punchItemId: string;
  position: number;
}) {
  const t = useTranslations("handovers.cancel");
  const [open, setOpen] = useState(false);
  const run = useAction(cancelPunchItemAction);
  const form = useForm<CancelValues, unknown, z.output<typeof cancelPunchItemSchema>>({
    resolver: zodResolver(cancelPunchItemSchema),
    defaultValues: { punchItemId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm" aria-label={t("openLabel", { position })}>
          <Ban data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title", { position })}
      description={t("description")}
      submitLabel={t("submit")}
      pending={run.pending}
      destructive
      onSubmit={form.handleSubmit(() =>
        run.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}

// ── PVs ─────────────────────────────────────────────────────────────────────

type SignValues = z.input<typeof signHandoverSchema>;

/**
 * Signs the PV de remise des clés with the buyer: final, the unit becomes delivered. Warns
 * when the sale is not fully paid (allowed: what remains is printed on the PV).
 */
export function SignHandoverDialog({
  handoverId,
  receivedBy,
  today,
  remaining,
  openReserves,
}: {
  handoverId: string;
  receivedBy: string;
  today: string;
  /** What remains to pay, formatted; null when the sale is fully paid. */
  remaining: string | null;
  openReserves: number;
}) {
  const t = useTranslations("handovers.sign");
  const [open, setOpen] = useState(false);
  const run = useAction(signHandoverAction);
  const form = useForm<SignValues, unknown, z.output<typeof signHandoverSchema>>({
    resolver: zodResolver(signHandoverSchema),
    defaultValues: {
      handoverId,
      signedOn: today,
      receivedBy,
      keysCount: "",
      electricityMeter: "",
      gasMeter: "",
      waterMeter: "",
      observations: "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <KeyRound data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description", { count: openReserves })}
      submitLabel={t("submit")}
      pending={run.pending}
      onSubmit={form.handleSubmit(() =>
        run.run(form.getValues(), {
          onSuccess: ({ number, coOwners }) => {
            toast.success(t("done", { number }));
            if (coOwners > 0) toast.info(t("coOwners", { count: coOwners }));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      {remaining ? (
        <Alert data-testid="handover-outstanding">
          <AlertDescription>{t("outstanding", { amount: remaining })}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="signedOn"
          label={t("date")}
          type="date"
          dir="ltr"
          max={today}
        />
        <TextField
          control={form.control}
          name="keysCount"
          label={t("keys")}
          inputMode="numeric"
          dir="ltr"
        />
      </div>
      <TextField control={form.control} name="receivedBy" label={t("receivedBy")} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          control={form.control}
          name="electricityMeter"
          label={t("electricity")}
          dir="ltr"
        />
        <TextField control={form.control} name="gasMeter" label={t("gas")} dir="ltr" />
        <TextField control={form.control} name="waterMeter" label={t("water")} dir="ltr" />
      </div>
      <TextareaField
        control={form.control}
        name="observations"
        label={t("observations")}
        rows={2}
      />
    </FormDialog>
  );
}

type CloseValues = z.input<typeof closeReservesSchema>;

/** PV de levée des réserves: every reserve lifted or cancelled. */
export function CloseReservesDialog({ handoverId, today }: { handoverId: string; today: string }) {
  const t = useTranslations("handovers.close");
  const [open, setOpen] = useState(false);
  const run = useAction(closeReservesAction);
  const form = useForm<CloseValues, unknown, z.output<typeof closeReservesSchema>>({
    resolver: zodResolver(closeReservesSchema),
    defaultValues: { handoverId, closedOn: today },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Stamp data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      pending={run.pending}
      onSubmit={form.handleSubmit(() =>
        run.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="closedOn"
        label={t("date")}
        type="date"
        dir="ltr"
        max={today}
      />
    </FormDialog>
  );
}

// ── Before the app ──────────────────────────────────────────────────────────

type PastValues = z.input<typeof pastDeliveriesSchema>;

/**
 * Marks units of a delivered project as delivered before the app; the units that have a
 * co-owner in the residence are ticked by default.
 */
export function PastDeliveriesDialog({
  projectId,
  units,
}: {
  projectId: string;
  units: PastDeliveryUnit[];
}) {
  const t = useTranslations("handovers.past");
  const ts = useTranslations("inventory.unitStatus");
  const [open, setOpen] = useState(false);
  const run = useAction(recordPastDeliveriesAction);
  const form = useForm<PastValues, unknown, z.output<typeof pastDeliveriesSchema>>({
    resolver: zodResolver(pastDeliveriesSchema),
    defaultValues: {
      projectId,
      unitIds: units.filter((u) => u.coOwner !== null).map((u) => u.id),
      reason: t("defaultReason"),
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <KeyRound data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      pending={run.pending}
      onSubmit={form.handleSubmit(() =>
        run.run(form.getValues(), {
          onSuccess: ({ delivered }) => {
            toast.success(t("done", { count: delivered }));
            setOpen(false);
          },
          onError: fieldErrors(form),
        }),
      )}
    >
      <CheckboxGroupField
        control={form.control}
        name="unitIds"
        label={t("units")}
        options={units.map((u) => ({
          value: u.id,
          label: `${u.code} · ${u.coOwner ?? ts(u.status)}`,
        }))}
      />
      <TextField control={form.control} name="reason" label={t("reason")} />
    </FormDialog>
  );
}
