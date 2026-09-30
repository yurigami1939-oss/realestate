"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus, Check, ClipboardCheck, PhoneCall } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { followUpChannels, visitStatuses, type VisitStatus } from "@/lib/crm";
import { formatDateTime, toAlgiersDateTimeInput } from "@/lib/dates";
import {
  completeFollowUpAction,
  createFollowUpAction,
  scheduleVisitAction,
  updateVisitAction,
} from "@/server/crm/actions";
import {
  completeFollowUpSchema,
  createFollowUpSchema,
  scheduleVisitSchema,
  updateVisitSchema,
} from "@/server/crm/schemas";

type Option = { id: string; name: string };
export type UnitChoice = { id: string; projectId: string; code: string; typology: string | null };

/** Tomorrow at the given hour, Algiers time, as a datetime-local value. */
const tomorrowAt = (hour: number) =>
  `${toAlgiersDateTimeInput(new Date(Date.now() + 24 * 3600 * 1000)).slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;

function useDialog() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

// ── Follow-ups ──────────────────────────────────────────────────────────────

type FollowUpValues = z.input<typeof createFollowUpSchema>;

export function NewFollowUpDialog({ leadId, owners }: { leadId: string; owners: Option[] | null }) {
  const t = useTranslations("crm");
  const tc = useTranslations("common");
  const dialog = useDialog();
  const run = useAction(createFollowUpAction);
  const form = useForm<FollowUpValues, unknown, z.output<typeof createFollowUpSchema>>({
    resolver: zodResolver(createFollowUpSchema),
    defaultValues: { leadId, dueAt: tomorrowAt(10), channel: "call", note: "", assignedTo: "" },
  });

  async function onSubmit(values: FollowUpValues) {
    await run.run(values, {
      onSuccess: () => {
        toast.success(t("followUps.created"));
        dialog.setOpen(false);
        form.reset({ ...values, note: "" });
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PhoneCall data-icon="inline-start" />
          {t("followUps.new")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("followUps.newTitle")}</DialogTitle>
        </DialogHeader>
        <form
          id="follow-up-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="dueAt"
                label={t("followUps.fields.dueAt")}
                type="datetime-local"
                dir="ltr"
              />
              <SelectField
                control={form.control}
                name="channel"
                label={t("followUps.fields.channel")}
                options={followUpChannels.map((c) => ({ value: c, label: t(`channel.${c}`) }))}
              />
            </div>
            {owners ? (
              <SelectField
                control={form.control}
                name="assignedTo"
                label={t("followUps.fields.assignedTo")}
                emptyLabel="—"
                options={owners.map((o) => ({ value: o.id, label: o.name }))}
              />
            ) : null}
            <TextareaField
              control={form.control}
              name="note"
              label={t("followUps.fields.note")}
              rows={2}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="follow-up-form" disabled={run.pending}>
            {tc("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CompleteValues = z.input<typeof completeFollowUpSchema>;

export function CompleteFollowUpDialog({ followUpId }: { followUpId: string }) {
  const t = useTranslations("crm.followUps");
  const tc = useTranslations("common");
  const dialog = useDialog();
  const run = useAction(completeFollowUpAction);
  const form = useForm<CompleteValues, unknown, z.output<typeof completeFollowUpSchema>>({
    resolver: zodResolver(completeFollowUpSchema),
    defaultValues: { followUpId, outcome: "" },
  });

  async function onSubmit(values: CompleteValues) {
    await run.run(values, {
      onSuccess: () => {
        toast.success(t("completed"));
        dialog.setOpen(false);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Check data-icon="inline-start" />
          {t("complete")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("completeTitle")}</DialogTitle>
        </DialogHeader>
        <form
          id={`complete-${followUpId}`}
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <TextareaField control={form.control} name="outcome" label={t("outcome")} rows={3} />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form={`complete-${followUpId}`} disabled={run.pending}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Visits ──────────────────────────────────────────────────────────────────

type VisitValues = z.input<typeof scheduleVisitSchema>;

export function ScheduleVisitDialog({
  leadId,
  projectId,
  projects,
  units,
  owners,
}: {
  leadId: string;
  projectId: string | null;
  projects: Option[];
  units: UnitChoice[];
  owners: Option[] | null;
}) {
  const t = useTranslations("crm");
  const tc = useTranslations("common");
  const dialog = useDialog();
  const run = useAction(scheduleVisitAction);
  const form = useForm<VisitValues, unknown, z.output<typeof scheduleVisitSchema>>({
    resolver: zodResolver(scheduleVisitSchema),
    defaultValues: {
      leadId,
      scheduledAt: tomorrowAt(15),
      projectId: projectId ?? "",
      unitId: "",
      agentUserId: "",
      notes: "",
    },
  });
  const selectedProject = useWatch({ control: form.control, name: "projectId" });
  const projectUnits = units.filter((u) => u.projectId === selectedProject);

  async function onSubmit(values: VisitValues) {
    await run.run(values, {
      onSuccess: () => {
        toast.success(t("visits.created"));
        dialog.setOpen(false);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlus data-icon="inline-start" />
          {t("visits.new")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("visits.newTitle")}</DialogTitle>
        </DialogHeader>
        <form
          id="visit-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <TextField
              control={form.control}
              name="scheduledAt"
              label={t("visits.fields.scheduledAt")}
              type="datetime-local"
              dir="ltr"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="projectId"
                label={t("visits.fields.projectId")}
                emptyLabel="—"
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
              />
              <SelectField
                control={form.control}
                name="unitId"
                label={t("visits.fields.unitId")}
                emptyLabel={t("visits.anyUnit")}
                options={projectUnits.map((u) => ({
                  value: u.id,
                  label: u.typology ? `${u.code} · ${u.typology}` : u.code,
                }))}
              />
            </div>
            {owners ? (
              <SelectField
                control={form.control}
                name="agentUserId"
                label={t("visits.fields.agentUserId")}
                emptyLabel="—"
                options={owners.map((o) => ({ value: o.id, label: o.name }))}
              />
            ) : null}
            <TextareaField
              control={form.control}
              name="notes"
              label={t("visits.fields.notes")}
              rows={2}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="visit-form" disabled={run.pending}>
            {tc("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type RecordValues = z.input<typeof updateVisitSchema>;

export function RecordVisitDialog({
  visitId,
  scheduledAt,
  status,
  outcome,
}: {
  visitId: string;
  scheduledAt: Date;
  status: VisitStatus;
  outcome: string | null;
}) {
  const t = useTranslations("crm");
  const tc = useTranslations("common");
  const dialog = useDialog();
  const run = useAction(updateVisitAction);
  const form = useForm<RecordValues, unknown, z.output<typeof updateVisitSchema>>({
    resolver: zodResolver(updateVisitSchema),
    defaultValues: {
      visitId,
      status: status === "planned" ? "done" : status,
      scheduledAt: toAlgiersDateTimeInput(scheduledAt),
      outcome: outcome ?? "",
    },
  });

  async function onSubmit(values: RecordValues) {
    await run.run(values, {
      onSuccess: () => {
        toast.success(t("visits.updated"));
        dialog.setOpen(false);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ClipboardCheck data-icon="inline-start" />
          {t("visits.record")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>
            {t("visits.recordTitle", { date: formatDateTime(scheduledAt) })}
          </DialogTitle>
        </DialogHeader>
        <form
          id={`visit-${visitId}`}
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="status"
                label={t("visits.fields.status")}
                options={visitStatuses.map((s) => ({ value: s, label: t(`visitStatus.${s}`) }))}
              />
              <TextField
                control={form.control}
                name="scheduledAt"
                label={t("visits.fields.scheduledAt")}
                type="datetime-local"
                dir="ltr"
              />
            </div>
            <TextareaField
              control={form.control}
              name="outcome"
              label={t("visits.fields.outcome")}
              rows={3}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form={`visit-${visitId}`} disabled={run.pending}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
