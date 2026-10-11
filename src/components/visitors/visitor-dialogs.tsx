"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { DoorOpen, UserPlus } from "lucide-react";
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
import {
  announceVisitorAction,
  cancelVisitorAction,
  logVisitorAction,
  recordArrivalAction,
} from "@/server/visitors/actions";
import { announceVisitorSchema, logVisitorSchema } from "@/server/visitors/schemas";

type Unit = { id: string; code: string; residenceName?: string };

/** The gate records an announced visitor's arrival. */
export function ArrivalButton({ passId }: { passId: string }) {
  const t = useTranslations("visitors");
  return (
    <ConfirmAction
      action={recordArrivalAction}
      input={{ passId }}
      label={t("arrived")}
      icon={<DoorOpen data-icon="inline-start" />}
      title={t("arrivedTitle")}
      description={t("arrivedDescription")}
      confirmLabel={t("arrived")}
      successMessage={t("recorded")}
      size="sm"
    />
  );
}

/** A visitor who came unannounced, logged as arrived now. */
export function LogVisitorDialog({ residenceId, units }: { residenceId: string; units: Unit[] }) {
  const t = useTranslations("visitors");
  const [open, setOpen] = useState(false);
  const log = useAction(logVisitorAction);
  const form = useForm<
    z.input<typeof logVisitorSchema>,
    unknown,
    z.output<typeof logVisitorSchema>
  >({
    resolver: zodResolver(logVisitorSchema),
    defaultValues: {
      residenceId,
      unitId: "",
      hostName: "",
      visitorName: "",
      people: "",
      note: "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <UserPlus data-icon="inline-start" />
          {t("log")}
        </Button>
      }
      title={t("logTitle")}
      submitLabel={t("log")}
      pending={log.pending}
      onSubmit={form.handleSubmit(() =>
        log.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("recorded"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="visitorName" label={t("fields.visitorName")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="unitId"
          label={t("fields.unit")}
          emptyLabel={t("commonAreas")}
          options={units.map((u) => ({ value: u.id, label: u.code }))}
        />
        <TextField control={form.control} name="hostName" label={t("fields.hostName")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="people"
          label={t("fields.people")}
          inputMode="numeric"
          dir="ltr"
        />
        <TextField control={form.control} name="note" label={t("fields.note")} />
      </div>
    </FormDialog>
  );
}

/** A resident announces a visitor: the code to give at the gate is shown once announced. */
export function AnnounceVisitorDialog({ units, today }: { units: Unit[]; today: string }) {
  const t = useTranslations("visitors");
  const [open, setOpen] = useState(false);
  const announce = useAction(announceVisitorAction);
  const form = useForm<
    z.input<typeof announceVisitorSchema>,
    unknown,
    z.output<typeof announceVisitorSchema>
  >({
    resolver: zodResolver(announceVisitorSchema),
    defaultValues: {
      unitId: units[0]?.id ?? "",
      visitorName: "",
      expectedOn: today,
      people: "",
      note: "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <UserPlus data-icon="inline-start" />
          {t("announce")}
        </Button>
      }
      title={t("announceTitle")}
      description={t("announceDescription")}
      submitLabel={t("announce")}
      pending={announce.pending}
      onSubmit={form.handleSubmit(() =>
        announce.run(form.getValues(), {
          onSuccess: ({ code }) => {
            toast.success(t("announced", { code }));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="visitorName" label={t("fields.visitorName")} />
      <div className="grid gap-4 sm:grid-cols-2">
        {units.length > 1 ? (
          <SelectField
            control={form.control}
            name="unitId"
            label={t("fields.unit")}
            options={units.map((u) => ({
              value: u.id,
              label: u.residenceName ? `${u.residenceName} · ${u.code}` : u.code,
            }))}
          />
        ) : null}
        <TextField
          control={form.control}
          name="expectedOn"
          label={t("fields.expectedOn")}
          type="date"
          min={today}
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="people"
          label={t("fields.people")}
          inputMode="numeric"
          dir="ltr"
        />
      </div>
      <TextField control={form.control} name="note" label={t("fields.note")} />
    </FormDialog>
  );
}

export function CancelVisitorButton({ passId }: { passId: string }) {
  const t = useTranslations("visitors");
  return (
    <ConfirmAction
      action={cancelVisitorAction}
      input={{ passId }}
      label={t("cancel")}
      title={t("cancelTitle")}
      description={t("cancelDescription")}
      confirmLabel={t("cancel")}
      successMessage={t("cancelled")}
      variant="ghost"
      size="sm"
      destructive
    />
  );
}
