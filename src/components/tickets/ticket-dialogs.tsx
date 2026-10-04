"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MessageSquare, Plus, UserCog } from "lucide-react";
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
import { useRouter } from "@/i18n/navigation";
import { type TicketStatus, ticketCategories, ticketPriorities } from "@/lib/tickets";
import {
  assignTicketAction,
  changeTicketStatusAction,
  commentTicketAction,
  createTicketAction,
} from "@/server/tickets/actions";
import type { TicketTarget } from "@/server/tickets/queries";
import {
  assignTicketSchema,
  changeTicketStatusSchema,
  commentTicketSchema,
  createTicketSchema,
} from "@/server/tickets/schemas";

type CreateValues = z.input<typeof createTicketSchema>;

/** Opens a ticket on a unit or the common areas of a residence. */
export function NewTicketDialog({
  targets,
  residenceId,
}: {
  targets: TicketTarget[];
  residenceId?: string;
}) {
  const t = useTranslations("tickets");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = useAction(createTicketAction);
  const form = useForm<CreateValues, unknown, z.output<typeof createTicketSchema>>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      residenceId: residenceId ?? targets[0]?.id ?? "",
      unitId: "",
      reporterName: "",
      title: "",
      description: "",
      category: "other",
      priority: "normal",
    },
  });
  const chosen = useWatch({ control: form.control, name: "residenceId" });
  const units = targets.find((r) => r.id === chosen)?.units ?? [];
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Plus data-icon="inline-start" />
          {t("new")}
        </Button>
      }
      title={t("newTitle")}
      submitLabel={t("create")}
      pending={create.pending}
      onSubmit={form.handleSubmit(() =>
        create.run(form.getValues(), {
          onSuccess: ({ id }) => {
            toast.success(t("created"));
            setOpen(false);
            router.push(`/tickets/${id}`);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="residenceId"
        label={t("fields.residenceId")}
        options={targets.map((r) => ({ value: r.id, label: r.name }))}
      />
      <SelectField
        key={chosen}
        control={form.control}
        name="unitId"
        label={t("fields.unitId")}
        emptyLabel={t("commonAreas")}
        options={units.map((u) => ({ value: u.unitId, label: u.code }))}
      />
      <TextField control={form.control} name="title" label={t("fields.title")} />
      <TextareaField
        control={form.control}
        name="description"
        label={t("fields.description")}
        rows={3}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="category"
          label={t("fields.category")}
          options={ticketCategories.map((c) => ({ value: c, label: t(`category.${c}`) }))}
        />
        <SelectField
          control={form.control}
          name="priority"
          label={t("fields.priority")}
          options={ticketPriorities.map((p) => ({ value: p, label: t(`priority.${p}`) }))}
        />
      </div>
      <TextField control={form.control} name="reporterName" label={t("fields.reporterName")} />
    </FormDialog>
  );
}

type StatusValues = z.input<typeof changeTicketStatusSchema>;

/** One allowed status change, with an optional comment. */
export function TicketStatusDialog({ ticketId, to }: { ticketId: string; to: TicketStatus }) {
  const t = useTranslations("tickets");
  const [open, setOpen] = useState(false);
  const change = useAction(changeTicketStatusAction);
  const form = useForm<StatusValues, unknown, z.output<typeof changeTicketStatusSchema>>({
    resolver: zodResolver(changeTicketStatusSchema),
    defaultValues: { ticketId, status: to, comment: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant={to === "cancelled" ? "ghost" : "outline"}>{t(`move.${to}`)}</Button>
      }
      title={t(`move.${to}`)}
      submitLabel={t(`move.${to}`)}
      destructive={to === "cancelled"}
      pending={change.pending}
      onSubmit={form.handleSubmit(() =>
        change.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("moved"));
            form.reset();
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="comment" label={t("fields.comment")} rows={2} />
    </FormDialog>
  );
}

type AssignValues = z.input<typeof assignTicketSchema>;

/** Assigns the ticket to an agent of the residence or a supplier. */
export function AssignTicketDialog({
  ticketId,
  staffId,
  supplierId,
  staff,
  suppliers,
}: {
  ticketId: string;
  staffId: string | null;
  supplierId: string | null;
  staff: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const t = useTranslations("tickets");
  const [open, setOpen] = useState(false);
  const assign = useAction(assignTicketAction);
  const form = useForm<AssignValues, unknown, z.output<typeof assignTicketSchema>>({
    resolver: zodResolver(assignTicketSchema),
    defaultValues: { ticketId, staffId: staffId ?? "", supplierId: supplierId ?? "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <UserCog data-icon="inline-start" />
          {t("assign")}
        </Button>
      }
      title={t("assignTitle")}
      description={t("assignDescription")}
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
        name="staffId"
        label={t("fields.staffId")}
        emptyLabel={t("nobody")}
        options={staff.map((s) => ({ value: s.id, label: s.name }))}
      />
      <SelectField
        control={form.control}
        name="supplierId"
        label={t("fields.supplierId")}
        emptyLabel={t("nobody")}
        options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
      />
    </FormDialog>
  );
}

type CommentValues = z.input<typeof commentTicketSchema>;

/** Adds a comment to the ticket's history. */
export function CommentTicketDialog({ ticketId }: { ticketId: string }) {
  const t = useTranslations("tickets");
  const [open, setOpen] = useState(false);
  const comment = useAction(commentTicketAction);
  const form = useForm<CommentValues, unknown, z.output<typeof commentTicketSchema>>({
    resolver: zodResolver(commentTicketSchema),
    defaultValues: { ticketId, comment: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline">
          <MessageSquare data-icon="inline-start" />
          {t("comment")}
        </Button>
      }
      title={t("comment")}
      submitLabel={t("comment")}
      pending={comment.pending}
      onSubmit={form.handleSubmit(() =>
        comment.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("commented"));
            form.reset();
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="comment" label={t("fields.comment")} rows={3} />
    </FormDialog>
  );
}
