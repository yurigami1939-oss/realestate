"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightLeft, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
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
import { leadStages, lostReasons, type LeadStage } from "@/lib/crm";
import { assignLeadAction, changeLeadStageAction } from "@/server/crm/actions";
import { assignLeadSchema, changeLeadStageSchema } from "@/server/crm/schemas";

type StageValues = z.input<typeof changeLeadStageSchema>;

export function StageDialog({
  leadId,
  name,
  stage,
}: {
  leadId: string;
  name: string;
  stage: LeadStage;
}) {
  const t = useTranslations("crm");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const run = useAction(changeLeadStageAction);
  const form = useForm<StageValues, unknown, z.output<typeof changeLeadStageSchema>>({
    resolver: zodResolver(changeLeadStageSchema),
    defaultValues: { leadId, stage, lostReason: "", lostNote: "" },
  });
  const lost = useWatch({ control: form.control, name: "stage" }) === "lost";

  async function onSubmit(values: StageValues) {
    await run.run(values, {
      onSuccess: () => {
        toast.success(t("leads.stageChanged"));
        setOpen(false);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArrowRightLeft data-icon="inline-start" />
          {t("leads.changeStage")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("leads.stageTitle", { name })}</DialogTitle>
        </DialogHeader>
        <form
          id="stage-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <SelectField
              control={form.control}
              name="stage"
              label={t("leads.columns.stage")}
              options={leadStages.map((s) => ({ value: s, label: t(`stage.${s}`) }))}
            />
            {lost ? (
              <>
                <SelectField
                  control={form.control}
                  name="lostReason"
                  label={t("leads.lostReason")}
                  emptyLabel="—"
                  options={lostReasons.map((r) => ({ value: r, label: t(`lostReason.${r}`) }))}
                />
                <TextareaField
                  control={form.control}
                  name="lostNote"
                  label={t("leads.lostNote")}
                  rows={2}
                />
              </>
            ) : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="stage-form" disabled={run.pending}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type AssignValues = z.input<typeof assignLeadSchema>;

export function AssignDialog({
  leadId,
  name,
  assignedTo,
  owners,
}: {
  leadId: string;
  name: string;
  assignedTo: string | null;
  owners: { id: string; name: string }[];
}) {
  const t = useTranslations("crm.leads");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const run = useAction(assignLeadAction);
  const form = useForm<AssignValues, unknown, z.output<typeof assignLeadSchema>>({
    resolver: zodResolver(assignLeadSchema),
    defaultValues: { leadId, assignedTo: assignedTo ?? "" },
  });

  async function onSubmit(values: AssignValues) {
    await run.run(values, {
      onSuccess: () => {
        toast.success(t("assigned"));
        setOpen(false);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserRound data-icon="inline-start" />
          {t("assign")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("assignTitle", { name })}</DialogTitle>
        </DialogHeader>
        <form
          id="assign-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <SelectField
              control={form.control}
              name="assignedTo"
              label={t("fields.assignedTo")}
              emptyLabel={t("unassigned")}
              options={owners.map((o) => ({ value: o.id, label: o.name }))}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="assign-form" disabled={run.pending}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
