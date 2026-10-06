"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, CheckCheck, HardHat, ShieldAlert } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WarrantyClaimStatus, WarrantyKind } from "@/lib/obligations";
import {
  assignWarrantyClaimAction,
  fixWarrantyClaimAction,
  rejectWarrantyClaimAction,
  reportPortalWarrantyClaimAction,
  reportWarrantyClaimAction,
} from "@/server/handovers/warranty-actions";
import {
  assignWarrantyClaimSchema,
  fixWarrantyClaimSchema,
  portalWarrantyClaimSchema,
  rejectWarrantyClaimSchema,
  reportWarrantyClaimSchema,
} from "@/server/handovers/schemas";

const variants: Record<WarrantyClaimStatus, "default" | "secondary" | "outline"> = {
  open: "outline",
  assigned: "default",
  fixed: "secondary",
  rejected: "secondary",
};

export function WarrantyClaimBadge({
  status,
  late,
}: {
  status: WarrantyClaimStatus;
  late?: boolean;
}) {
  const t = useTranslations("warranty.status");
  return (
    <Badge variant={late ? "destructive" : variants[status]} data-status={status}>
      {late ? t("late") : t(status)}
    </Badge>
  );
}

/** Staff record a defect reported after the handover (phone, visit, letter…). */
export function ReportClaimDialog({ handoverId, today }: { handoverId: string; today: string }) {
  const t = useTranslations("warranty");
  const [open, setOpen] = useState(false);
  const report = useAction(reportWarrantyClaimAction);
  const form = useForm<
    z.input<typeof reportWarrantyClaimSchema>,
    unknown,
    z.output<typeof reportWarrantyClaimSchema>
  >({
    resolver: zodResolver(reportWarrantyClaimSchema),
    defaultValues: { handoverId, location: "", description: "", reportedOn: today },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <ShieldAlert data-icon="inline-start" />
          {t("report")}
        </Button>
      }
      title={t("reportTitle")}
      submitLabel={t("report")}
      pending={report.pending}
      onSubmit={form.handleSubmit(() =>
        report.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("reported"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="location" label={t("fields.location")} />
      <TextareaField
        control={form.control}
        name="description"
        label={t("fields.description")}
        rows={3}
      />
      <TextField
        control={form.control}
        name="reportedOn"
        label={t("fields.reportedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
    </FormDialog>
  );
}

/** A buyer reports a defect of their delivered unit (portal). */
export function PortalClaimDialog({ reservationId }: { reservationId: string }) {
  const t = useTranslations("warranty");
  const [open, setOpen] = useState(false);
  const report = useAction(reportPortalWarrantyClaimAction);
  const form = useForm<
    z.input<typeof portalWarrantyClaimSchema>,
    unknown,
    z.output<typeof portalWarrantyClaimSchema>
  >({
    resolver: zodResolver(portalWarrantyClaimSchema),
    defaultValues: { reservationId, location: "", description: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <ShieldAlert data-icon="inline-start" />
          {t("portalReport")}
        </Button>
      }
      title={t("portalReportTitle")}
      description={t("portalReportHint")}
      submitLabel={t("send")}
      pending={report.pending}
      onSubmit={form.handleSubmit(() =>
        report.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("sent"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="location" label={t("fields.location")} />
      <TextareaField
        control={form.control}
        name="description"
        label={t("fields.description")}
        rows={3}
      />
    </FormDialog>
  );
}

/** Qualifies the claim under a running warranty and passes it to a contractor. */
export function AssignClaimDialog({
  claimId,
  kinds,
  contractors,
  dueOn,
  today,
}: {
  claimId: string;
  /** Warranties running when the claim was reported. */
  kinds: WarrantyKind[];
  contractors: { id: string; name: string }[];
  dueOn: string;
  today: string;
}) {
  const t = useTranslations("warranty");
  const [open, setOpen] = useState(false);
  const assign = useAction(assignWarrantyClaimAction);
  const form = useForm<
    z.input<typeof assignWarrantyClaimSchema>,
    unknown,
    z.output<typeof assignWarrantyClaimSchema>
  >({
    resolver: zodResolver(assignWarrantyClaimSchema),
    defaultValues: {
      claimId,
      warrantyKind: kinds[0] ?? "ten_year",
      supplierId: contractors[0]?.id ?? "",
      dueOn,
      note: "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <HardHat data-icon="inline-start" />
          {t("assign")}
        </Button>
      }
      title={t("assignTitle")}
      submitLabel={t("assign")}
      pending={assign.pending}
      onSubmit={form.handleSubmit(() =>
        assign.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("assigned"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="warrantyKind"
        label={t("fields.warrantyKind")}
        options={kinds.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
      />
      <SelectField
        control={form.control}
        name="supplierId"
        label={t("fields.contractor")}
        options={contractors.map((c) => ({ value: c.id, label: c.name }))}
      />
      <TextField
        control={form.control}
        name="dueOn"
        label={t("fields.dueOn")}
        type="date"
        dir="ltr"
        min={today}
      />
      <TextareaField control={form.control} name="note" label={t("fields.note")} rows={2} />
    </FormDialog>
  );
}

/** The contractor fixed it. */
export function FixClaimDialog({ claimId, today }: { claimId: string; today: string }) {
  const t = useTranslations("warranty");
  const [open, setOpen] = useState(false);
  const fix = useAction(fixWarrantyClaimAction);
  const form = useForm<
    z.input<typeof fixWarrantyClaimSchema>,
    unknown,
    z.output<typeof fixWarrantyClaimSchema>
  >({
    resolver: zodResolver(fixWarrantyClaimSchema),
    defaultValues: { claimId, fixedOn: today, note: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <CheckCheck data-icon="inline-start" />
          {t("fix")}
        </Button>
      }
      title={t("fixTitle")}
      submitLabel={t("fix")}
      pending={fix.pending}
      onSubmit={form.handleSubmit(() =>
        fix.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("fixed"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="fixedOn"
        label={t("fields.fixedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
      <TextareaField control={form.control} name="note" label={t("fields.note")} rows={2} />
    </FormDialog>
  );
}

/** Rejected with a reason the buyer reads. */
export function RejectClaimDialog({ claimId }: { claimId: string }) {
  const t = useTranslations("warranty");
  const [open, setOpen] = useState(false);
  const reject = useAction(rejectWarrantyClaimAction);
  const form = useForm<
    z.input<typeof rejectWarrantyClaimSchema>,
    unknown,
    z.output<typeof rejectWarrantyClaimSchema>
  >({
    resolver: zodResolver(rejectWarrantyClaimSchema),
    defaultValues: { claimId, note: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <Ban data-icon="inline-start" />
          {t("reject")}
        </Button>
      }
      title={t("rejectTitle")}
      submitLabel={t("reject")}
      destructive
      pending={reject.pending}
      onSubmit={form.handleSubmit(() =>
        reject.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("rejected"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="note" label={t("fields.reason")} rows={2} />
    </FormDialog>
  );
}
